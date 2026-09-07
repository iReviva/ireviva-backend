import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const processedEvents = new Set();

// ===== Helpers =====
function splitName(fullName = "") {
  const parts = fullName.trim().split(/\s+/);
  return {
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" ") || "",
  };
}

function buildAddress(details = {}) {
  const name = splitName(details.name || "");
  const address = details.address || {};

  return {
    first_name: name.first_name,
    last_name: name.last_name,
    address1: address.line1 || "",
    address2: address.line2 || "",
    city: address.city || "",
    province: address.state || "",
    country: address.country || "",
    zip: address.postal_code || "",
    phone: details.phone || "",
  };
}

async function sendOpenAIOrderCreated(session, eventCreatedSeconds) {
  const pixelId = process.env.OPENAI_ADS_PIXEL_ID;
  const apiKey = process.env.OPENAI_ADS_CONVERSIONS_API_KEY;

  if (!pixelId || !apiKey) {
    console.log("ℹ️ OpenAI Ads CAPI not configured; skipping conversion event");
    return;
  }

  // Never send Stripe test-mode purchases into the live Ads measurement source.
  if (session.livemode === false) {
    console.log("🧪 OpenAI Ads CAPI skipped for Stripe test payment");
    return;
  }

  const conversionEvent = {
    id: session.id,
    type: "order_created",
    timestamp_ms:
      Number(eventCreatedSeconds || session.created || Math.floor(Date.now() / 1000)) * 1000,
    source_url: "https://ireviva.com/success",
    action_source: "web",
    data: {
      type: "contents",
      amount: Number(session.amount_total || 0),
      currency: String(session.currency || "usd").toUpperCase(),
      contents: [
        {
          id: "ireviva-stripe-checkout",
          name: "iReviva™ Face & Neck LED Mask",
          content_type: "product",
          quantity: 1,
        },
      ],
    },
  };

  const oppref = session.metadata?.openai_oppref;
  if (oppref) {
    conversionEvent.oppref = oppref;
  }

  const response = await fetch(
    `https://bzr.openai.com/v1/events?pid=${encodeURIComponent(pixelId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        validate_only: false,
        integration_source: "ireviva_stripe_checkout",
        events: [conversionEvent],
      }),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI Ads CAPI ${response.status}: ${responseText || "request failed"}`
    );
  }

  console.log(
    `✅ OpenAI order_created sent: ${session.id}`,
    responseText || "accepted"
  );
}

// ===== Health check =====
app.get("/", (req, res) => {
  res.send("Backend iReviva OK ✅");
});

// ===== Checkout session =====
app.post("/create-checkout-session", express.json(), async (req, res) => {
  try {
    const rawOppref = req.body?.oppref;
    const oppref =
      typeof rawOppref === "string" && rawOppref.trim()
        ? rawOppref.trim().slice(0, 500)
        : null;

    const metadata = {};
    if (oppref) {
      metadata.openai_oppref = oppref;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",

      billing_address_collection: "required",

      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB", "FR", "DE", "IT", "ES", "SA", "AE"],
      },

      phone_number_collection: {
        enabled: true,
      },

      metadata,

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "iReviva™ Face & Neck LED Mask",
            },
            unit_amount: 29900,
          },
          quantity: 1,
        },
      ],

      success_url: "https://ireviva.com/success",
      cancel_url: "https://ireviva.com/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe checkout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== Webhook Stripe =====
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Signature error:", err.message);
    return res.status(400).send("Webhook error");
  }

  // Anti-duplicate
  if (processedEvents.has(event.id)) {
    return res.status(200).json({ duplicate: true });
  }
  processedEvents.add(event.id);
  setTimeout(() => processedEvents.delete(event.id), 10 * 60 * 1000);

  // On ignore autres events
  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ ignored: true });
  }

  const session = event.data.object;

  // Vérification paiement
  if (session.payment_status !== "paid") {
    console.log("❌ Payment not completed");
    return res.status(200).end();
  }

  // ===== TEST vs LIVE =====
  const isTest = session.livemode === false;

  console.log(isTest ? "🧪 TEST PAYMENT" : "💰 LIVE PAYMENT");

  // ===== DATA =====
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || {};

  const finalDetails = {
    name: shipping.name || customer.name || "",
    email: customer.email || "",
    phone: customer.phone || shipping.phone || "",
    address: shipping.address || customer.address || {},
  };

  const name = splitName(finalDetails.name);
  const address = buildAddress(finalDetails);
  const amount = ((session.amount_total || 0) / 100).toFixed(2);

  // ===== OPENAI ADS CONVERSION =====
  try {
    await sendOpenAIOrderCreated(session, event.created);
  } catch (err) {
    // Tracking failure must never block order creation or webhook acknowledgement.
    console.error("❌ OpenAI Ads CAPI error:", err.message);
  }

  // ===== SHOPIFY ORDER =====
  const orderPayload = {
    order: {
      email: finalDetails.email,
      financial_status: "paid",
      currency: "USD",

      tags: isTest
        ? "TEST, Stripe, iReviva"
        : "LIVE, Stripe, iReviva",

      note: `Stripe Session: ${session.id}`,

      customer: {
        first_name: name.first_name,
        last_name: name.last_name,
        email: finalDetails.email,
        phone: finalDetails.phone,
      },

      shipping_address: address,
      billing_address: address,

      line_items: [
        {
          title: "iReviva™ Face & Neck LED Mask",
          price: Number(amount),
          quantity: 1,
        },
      ],
    },
  };

  try {
    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderPayload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Shopify error:", response.status, data);
      return res.status(200).json({ error: true });
    }

    console.log(
      isTest
        ? "🧪 TEST ORDER CREATED:"
        : "💰 LIVE ORDER CREATED:",
      data.order?.name
    );

  } catch (err) {
    console.error("❌ Shopify fetch error:", err.message);
  }

  res.status(200).json({ received: true });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
