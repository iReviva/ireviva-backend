import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// =====================
// 🔐 OAUTH SHOPIFY
// =====================

app.get("/auth", (req, res) => {
  const shop = process.env.SHOPIFY_STORE;

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_CLIENT_ID}&scope=write_orders&redirect_uri=${process.env.REDIRECT_URI}`;

  res.redirect(installUrl);
});

app.get("/callback", async (req, res) => {
  const { shop, code } = req.query;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  const data = await response.json();

  console.log("🔥 SHOPIFY ACCESS TOKEN:", data.access_token);

  res.send("App installed. Check Render logs.");
});

// =====================
// 🔥 WEBHOOK STRIPE
// =====================

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
      console.error("❌ Stripe error:", err.message);
      return res.status(400).send();
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const email = session.customer_details?.email;

      try {
        const response = await fetch(
          `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              order: {
                email,
                financial_status: "paid",
                line_items: [
                  {
                    title: "iReviva™ Mask",
                    price: "199.00",
                    quantity: 1,
                  },
                ],
              },
            }),
          }
        );

        const data = await response.json();
        console.log("🛒 Shopify order:", data);

      } catch (err) {
        console.error("❌ Shopify error:", err.message);
      }
    }

    res.json({ received: true });
  }
);

app.use(express.json());

app.listen(3000, () => console.log("Server running"));
