import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const processedEvents = new Set();

function splitName(fullName = "") {
  const parts = fullName.trim().split(" ");
  return {
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" ") || "",
  };
}

function buildAddress(customerDetails) {
  const name = splitName(customerDetails?.name || "");
  const address = customerDetails?.address || {};

  return {
    first_name: name.first_name,
    last_name: name.last_name,
    address1: address.line1 || "",
    address2: address.line2 || "",
    city: address.city || "",
    province: address.state || "",
    country: address.country || "",
    zip: address.postal_code || "",
    phone: customerDetails?.phone || "",
  };
}

// ✅ Backend OK
app.get("/", (req, res) => {
  res.send("Backend iReviva OK ✅");
});

// ✅ OAuth Shopify - installation app
app.get("/auth", (req, res) => {
  const shop = process.env.SHOPIFY_STORE;

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_CLIENT_ID}` +
    `&scope=read_orders,write_orders` +
    `&redirect_uri=${process.env.REDIRECT_URI}`;

  console.log("👉 URL INSTALL:", installUrl);
  res.redirect(installUrl);
});

// ✅ OAuth Shopify - récupération token
app.get("/callback", async (req, res) => {
  const { code } = req.query;

  try {
    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_CLIENT_ID,
          client_secret: process.env.SHOPIFY_CLIENT_SECRET,
          code,
        }),
      }
    );

    const data = await response.json();

    console.log("🔥 SHOPIFY ACCESS TOKEN:", data.access_token);

    res.send("App installée ✅ Regarde les logs Render");
  } catch (err) {
    console.error("❌ OAuth error:", err.message);
    res.status(500).send("Erreur OAuth");
  }
});

// ✅ Option backend checkout propre
app.post("/create-checkout-session", express.json(), async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      billing_address_collection: "required",
      phone_number_collection: {
        enabled: true,
      },
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB", "FR", "DE", "IT", "ES", "SA", "AE"],
      },
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

// ✅ Stripe Webhook → Shopify Order
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe signature error:", err.message);
    return res.status(400).send("Webhook signature error");
  }

  if (processedEvents.has(event.id)) {
    console.log("⚠️ Event déjà traité:", event.id);
    return res.status(200).json({ duplicate: true });
  }

  processedEvents.add(event.id);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const customerDetails = session.customer_details || {};
    const email = customerDetails.email || "no-email";
    const fullName = customerDetails.name || "";
    const phone = customerDetails.phone || "";
    const amount = ((session.amount_total || 0) / 100).toFixed(2);

    const name = splitName(fullName);
    const address = buildAddress(customerDetails);

    const orderPayload = {
      order: {
        email,
        financial_status: "paid",
        currency: "USD",
        tags: "Stripe, iReviva, Auto Order",
        note: `Stripe Checkout Session: ${session.id}`,

        customer: {
          first_name: name.first_name,
          last_name: name.last_name,
          email,
          phone,
        },

        shipping_address: address,
        billing_address: address,

        line_items: [
          {
            title: "iReviva™ Face & Neck LED Mask",
            price: amount,
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
        console.error("❌ Shopify API error:", response.status, data);
      } else {
        console.log("✅ Shopify order created:", data.order?.name || data.order?.id);
      }
    } catch (err) {
      console.error("❌ Shopify fetch error:", err.message);
    }
  }

  res.status(200).json({ received: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
