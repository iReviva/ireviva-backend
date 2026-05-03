import express from "express";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/webhook", async (req, res) => {
  const event = req.body;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const email = session.customer_details.email;
    const amount = session.amount_total / 100;

    await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order: {
          email: email,
          line_items: [
            {
              title: "iReviva™ Pro 234 LED Mask",
              price: amount,
              quantity: 1,
            },
          ],
          financial_status: "paid",
        },
      }),
    });
  }

  res.json({ received: true });
});

app.listen(3000, () => console.log("Server running"));
