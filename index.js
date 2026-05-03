import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Anti-doublon simple en mémoire
const processedEvents = new Set();

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

    const email = session.customer_details?.email || "no-email";
    const name = session.customer_details?.name || "Customer";
    const amount = ((session.amount_total || 0) / 100).toFixed(2);

    const address = session.customer_details?.address;

    const orderPayload = {
      order: {
        email,
        financial_status: "paid",
        note: `Stripe Checkout Session: ${session.id}`,
        tags: "Stripe, iReviva, Auto Order",
        customer: {
          first_name: name.split(" ")[0] || name,
          last_name: name.split(" ").slice(1).join(" ") || "",
          email
        },
        line_items: [
          {
            title: "iReviva™ Pro 234 LED Mask",
            price: amount,
            quantity: 1
          }
        ]
      }
    };

    if (address) {
      orderPayload.order.shipping_address = {
        first_name: name.split(" ")[0] || name,
        last_name: name.split(" ").slice(1).join(" ") || "",
        address1: address.line1 || "",
        address2: address.line2 || "",
        city: address.city || "",
        province: address.state || "",
        country: address.country || "",
        zip: address.postal_code || ""
      };

      orderPayload.order.billing_address = orderPayload.order.shipping_address;
    }

    try {
      const response = await fetch(
        `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(orderPayload)
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

app.get("/callback", async (req, res) => {
  const { code } = req.query;

  try {
    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_CLIENT_ID,
          client_secret: process.env.SHOPIFY_CLIENT_SECRET,
          code
        })
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

app.get("/", (req, res) => {
  res.send("Backend iReviva OK ✅");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
