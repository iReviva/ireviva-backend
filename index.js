import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();

// ⚠️ IMPORTANT : RAW body pour Stripe (AVANT tout)
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      console.log("🔥 EVENT:", event.type);

    } catch (err) {
      console.error("❌ SIGNATURE ERROR:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ============================
    // ✅ CHECKOUT SUCCESS
    // ============================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const email = session.customer_details?.email;
      const amount = session.amount_total / 100;

      console.log("✅ CHECKOUT OK:", email, amount);

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
                email: email,
                financial_status: "paid",
                line_items: [
                  {
                    title: "iReviva™ Pro 234 LED Mask",
                    price: amount,
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

    res.status(200).json({ received: true });
  }
);

// ⚠️ JSON parser APRÈS webhook
app.use(express.json());

app.get("/", (req, res) => {
  res.send("iReviva backend running ✅");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
