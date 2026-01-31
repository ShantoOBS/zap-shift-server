const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_KEY);

const app = express();
const port = process.env.PORT || 3000;

// -------------------- MIDDLEWARE --------------------
app.use(cors());
app.use(express.json());

// -------------------- UTILS --------------------
function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

// -------------------- MONGODB SETUP --------------------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.t2y7ypa.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("zap_shift_db");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");

    // -------------------- PARCEL ROUTES --------------------

    // Create parcel
    app.post('/parcels', async (req, res) => {
      const parcel = {
        ...req.body,
        createdAt: new Date(),
        paymentStatus: "unpaid",
      };

      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    // Get parcels (optional email filter)
    app.get('/parcels', async (req, res) => {
      const query = {};
      if (req.query.email) {
        query.senderEmail = req.query.email;
      }

      const parcels = await parcelCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(parcels);
    });

    // Delete parcel
    app.delete('/parcels/:id', async (req, res) => {
      const result = await parcelCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    // -------------------- STRIPE ROUTES --------------------

    // Create checkout session
    app.post('/create-checkout-session', async (req, res) => {
      const { cost, parcelName, senderEmail, parcelId } = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(Number(cost) * 100),
              product_data: {
                name: parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: senderEmail,
        mode: 'payment',
        metadata: { parcelId, parcelName },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/my-parcels?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
      });

      res.send({ url: session.url });
    });

    // Payment success handler
    app.patch('/payment-success', async (req, res) => {
      const { session_id } = req.query;

      if (!session_id) {
        return res.status(400).send({ error: "Session ID required" });
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== 'paid') {
        return res.send({ success: false });
      }

      const trackingId = generateTrackingId();
      const parcelId = session.metadata.parcelId;

      // Update parcel
      const parcelUpdate = await parcelCollection.updateOne(
        { _id: new ObjectId(parcelId) },
        {
          $set: {
            paymentStatus: 'paid',
            trackingId,
          },
        }
      );

      // Save payment info
      const payment = {
        amount: session.amount_total / 100,
        currency: session.currency,
        customerEmail: session.customer_email,
        parcelId,
        parcelName: session.metadata.parcelName,
        transactionId: session.payment_intent,
        paymentStatus: session.payment_status,
        paidAt: new Date(),
      };

      const paymentResult = await paymentCollection.insertOne(payment);

      return res.send({
        success: true,
        trackingId,
        transactionId: session.payment_intent,
        modifyParcel: parcelUpdate,
        paymentInfo: paymentResult,
      });
    });

    // -------------------- HEALTH CHECK --------------------
    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error(error);
  }
}

run();

// -------------------- ROOT --------------------
app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});

// -------------------- SERVER --------------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
