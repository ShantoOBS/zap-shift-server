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

const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) return res.status(401).send({ message: 'unauthorize access' });

  try {

    const tokenId = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(tokenId);
    req.decoded_email = decoded.email;
    next();

  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorize access' });
  }


}

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
    const userCollection = db.collection('users');
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const ridersCollection = db.collection('riders');
    const trackingsCollection = db.collection('trackings');



    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }

      next();
    }

    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split('_').join(' '),
        createdAt: new Date()
      }
      const result = await trackingsCollection.insertOne(log);
      return result;
    }

    //dashboard
    app.get('/dashboard/overview', async (req, res) => {
  try {

    const newPackages = await parcelCollection.countDocuments();

    const readyForShipping = await parcelCollection.countDocuments({
      deliveryStatus: 'pending-pickup'
    });

    const completed = await parcelCollection.countDocuments({
      deliveryStatus: 'parcel_delivered'
    });

    const newClients = await userCollection.countDocuments({
      role: 'user'
    });

    res.send({
      newPackages,
      readyForShipping,
      completed,
      newClients
    });

  } catch (error) {
    res.status(500).send({ message: "Dashboard overview error" });
  }
});

app.get('/dashboard/shipment-stats', async (req, res) => {

  const stats = await parcelCollection.aggregate([
    {
      $group: {
        _id: {
          $dayOfWeek: "$createdAt"
        },
        total: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]).toArray();

  res.send(stats);
});

app.get('/dashboard/shipping-reports', async (req, res) => {

  const reports = await parcelCollection.aggregate([
    {
      $lookup: {
        from: "users",
        localField: "senderEmail",
        foreignField: "email",
        as: "client"
      }
    },
    {
      $unwind: "$client"
    },
    {
      $project: {
        parcelName: 1,
        cost: 1,
        deliveryStatus: 1,
        createdAt: 1,
        trackingId: 1,
        clientName: "$client.displayName"
      }
    },
    {
      $sort: { createdAt: -1 }
    },
    {
      $limit: 10
    }
  ]).toArray();

  res.send(reports);
});

app.get('/dashboard/late-invoices', async (req, res) => {

  const invoices = await paymentCollection
    .find({})
    .sort({ paidAt: -1 })
    .limit(5)
    .toArray();

  res.send(invoices);
});

app.get('/dashboard/shipment-alerts', async (req, res) => {

  const alerts = await trackingsCollection
    .find({
      status: { $in: ['damaged', 'delayed'] }
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  res.send(alerts);
});

app.get('/dashboard/revenue', async (req, res) => {

  const revenue = await paymentCollection.aggregate([
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$amount" }
      }
    }
  ]).toArray();

  res.send(revenue[0] || { totalRevenue: 0 });
});

    // users related apis
    app.get('/users', verifyToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (searchText) {
        // query.displayName = {$regex: searchText, $options: 'i'}

        query.$or = [
          { displayName: { $regex: searchText, $options: 'i' } },
          { email: { $regex: searchText, $options: 'i' } },
        ]

      }

      const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/users/:id', async (req, res) => {

    })

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || 'user' })
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email })

      if (userExists) {
        return res.send({ message: 'user exists' })
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    app.patch('/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: roleInfo.role
        }
      }
      const result = await userCollection.updateOne(query, updatedDoc)
      res.send(result);
    })
    app.delete('/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) }

      const result = await userCollection.deleteOne(query);
      res.send(result);
    })


    // payment related apis
    app.get('/payments', verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = {}

      // console.log( 'headers', req.headers);

      if (email) {
        query.customerEmail = email;

        // check email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })

    // riders related apis
    app.get('/riders', async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {}

      if (status) {
        query.status = status;
      }
      if (district) {
        query.district = district
      }
      if (workStatus) {
        query.workStatus = workStatus
      }

      const cursor = ridersCollection.find(query)
      const result = await cursor.toArray();
      res.send(result);
    })

    app.post('/riders', async (req, res) => {
      const rider = req.body;
      rider.status = 'pending';
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    })

    app.patch('/riders/:id', verifyToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          status: status,
          workStatus: 'available'
        }
      }

      const result = await ridersCollection.updateOne(query, updatedDoc);

      if (status === 'approved') {
        const email = req.body.email;
        const userQuery = { email }
        const updateUser = {
          $set: {
            role: 'rider'
          }
        }
        const userResult = await userCollection.updateOne(userQuery, updateUser);
      }

      res.send(result);
    })

    app.delete('/riders/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ridersCollection.deleteOne(query);
      res.send(result);
    })

    // -------------------- PARCEL ROUTES --------------------

    // Create parcel
    app.post('/parcels', async (req, res) => {
      const trackingId = generateTrackingId();
      const parcel = {
        ...req.body,
        createdAt: new Date(),
        paymentStatus: "unpaid",
        trackingId : trackingId
      };

      logTracking(trackingId, 'parcel_created');

      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    // Get parcels (optional email filter)
    app.get('/parcels', async (req, res) => {
      const query = {}
      const { email, deliveryStatus } = req.query;

      // /parcels?email=''&
      if (email) {
        query.senderEmail = email;
      }

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus
      }

      const options = { sort: { createdAt: -1 } }

      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/parcels/rider', async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {}

      if (riderEmail) {
        query.riderEmail = riderEmail
      }
      if (deliveryStatus !== 'parcel_delivered') {
        // query.deliveryStatus = {$in: ['driver_assigned', 'rider_arriving']}
        query.deliveryStatus = { $nin: ['parcel_delivered'] }
      }
      else {
        query.deliveryStatus = deliveryStatus;
      }

      const cursor = parcelCollection.find(query)
      const result = await cursor.toArray();
      res.send(result);
    })

    app.patch('/parcels/:id/status', async (req, res) => {
      const { deliveryStatus, riderId, trackingId } = req.body;

      const query = { _id: new ObjectId(req.params.id) }
      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus
        }
      }

      if (deliveryStatus === 'parcel_delivered') {
        // update rider information
        const riderQuery = { _id: new ObjectId(riderId) }
        const riderUpdatedDoc = {
          $set: {
            workStatus: 'available'
          }
        }
        const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);
      }

      const result = await parcelCollection.updateOne(query, updatedDoc)
      // log tracking
      logTracking(trackingId, deliveryStatus);

      res.send(result);
    })


    app.patch('/parcels/:id', async (req, res) => {
      const { riderId, riderName, riderEmail, trackingId } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const updatedDoc = {
        $set: {
          deliveryStatus: 'driver_assigned',
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail
        }
      }

      const result = await parcelCollection.updateOne(query, updatedDoc)

      // update rider information
      const riderQuery = { _id: new ObjectId(riderId) }
      const riderUpdatedDoc = {
        $set: {
          workStatus: 'in_delivery'
        }
      }
      const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);
      logTracking(trackingId, 'driver_assigned')
      res.send(riderResult);

    })

    // Delete parcel
    app.delete('/parcels/:id', async (req, res) => {
      const result = await parcelCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    // Update parcel (Edit)
    app.patch('/parcels/update-parcel/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { parcelName, cost } = req.body;

        const updateDoc = {
          $set: {
            parcelName,
            cost,
            updatedAt: new Date(),
          },
        };

        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to update parcel' });
      }
    });




    // -------------------- STRIPE ROUTES --------------------

    // Create checkout session
    app.post('/create-checkout-session', async (req, res) => {
  try {

    const { cost, parcelName, senderEmail, parcelId, trackingId } = req.body;

    if (!cost || !parcelName || !senderEmail || !parcelId) {
      return res.status(400).send({ message: "Missing payment data" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',

      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: parcelName },
            unit_amount: Math.round(Number(cost) * 100),
          },
          quantity: 1,
        },
      ],

      customer_email: senderEmail,

      metadata: {
        parcelId,
        parcelName,
        trackingId
      },

      success_url: `${process.env.SITE_DOMAIN}/dashboard/my-parcels?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
    });

    res.send({ url: session.url });

  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Stripe checkout failed" });
  }
});

    // Payment success handler
  app.patch('/payment-success', async (req, res) => {
  try {

    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).send({ message: "Session ID missing" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const transactionId = session.payment_intent;

    const paymentExist = await paymentCollection.findOne({ transactionId });

    if (paymentExist) {
      return res.send({
        message: 'already exists',
        transactionId,
        trackingId: paymentExist.trackingId
      });
    }

    if (session.payment_status !== 'paid') {
      return res.send({ success: false });
    }

    const trackingId = session.metadata.trackingId;

    const result = await parcelCollection.updateOne(
      { _id: new ObjectId(session.metadata.parcelId) },
      {
        $set: {
          paymentStatus: 'paid',
          deliveryStatus: 'pending-pickup'
        }
      }
    );

    const payment = {
      amount: session.amount_total / 100,
      currency: session.currency,
      customerEmail: session.customer_email,
      parcelId: session.metadata.parcelId,
      parcelName: session.metadata.parcelName,
      transactionId,
      paymentStatus: session.payment_status,
      paidAt: new Date(),
      trackingId
    };

    const resultPayment = await paymentCollection.insertOne(payment);

    logTracking(trackingId, 'parcel_paid')

    res.send({
      success: true,
      modifyParcel: result,
      paymentInfo: resultPayment,
      trackingId,
      transactionId
    });

  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false });
  }
});

    app.get('/payments', verifyToken, async (req, res) => {
      const email = req.query.email;

      console.log(req.headers);

      const query = {};
      if (email) {
        query.customerEmail = email;
        if (email !== req.decoded_email) return res.status(403).send({ message: 'forbidden access' });
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();

      res.send(result);


    })

     // tracking related apis
        app.get('/trackings/:trackingId/logs', async (req, res) => {
            const trackingId = req.params.trackingId;
            const query = { trackingId };
            const result = await trackingsCollection.find(query).toArray();
            res.send(result);
        })

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
