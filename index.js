import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();

// =====================
// CONFIG
// =====================

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ⚠️ IMPORTANT pour Stripe webhook
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Stripe signature error:", err.message);
      return res.status(400).send();
    }

    console.log("✅ Stripe event reçu:", event.type);

    // =====================
    // CHECKOUT COMPLETED
    // =====================

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const email = session.customer_details?.email || "no-email";
      const amount = (session.amount_total || 0) / 100;

      console.log("💰 Paiement reçu:", email, amount);

      try {
        const response = await fetch(
          `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token":
                process.env.SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              order: {
                email: email,
                financial_status: "paid",
                line_items: [
                  {
                    title: "iReviva™ Pro 234 LED Mask",
                    price: amount.toString(),
                    quantity: 1,
                  },
                ],
              },
            }),
          }
        );

        const data = await response.json();

        console.log("🛒 Shopify réponse:", data);
      } catch (err) {
        console.error("❌ Shopify error:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// =====================
// 🔐 OAUTH SHOPIFY (INSTALL)
// =====================

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

// =====================
// 🔐 CALLBACK (RÉCUPÈRE TOKEN)
// =====================

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
          code: code,
        }),
      }
    );

    const data = await response.json();

    console.log("🔥 SHOPIFY ACCESS TOKEN:", data.access_token);

    res.send("App installée ✅ Regarde les logs Render");
  } catch (err) {
    console.error("❌ OAuth error:", err.message);
    res.send("Erreur OAuth");
  }
});

// =====================
// DEFAULT ROUTE
// =====================

app.get("/", (req, res) => {
  res.send("Backend iReviva OK");
});

// =====================
// START SERVER
// =====================

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
