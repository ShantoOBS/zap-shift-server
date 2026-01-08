const express = require('express')
const cors =require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const app = express()
const port = 3000

const stripe = require('stripe')(`${process.env.STRIPE_KEY}`);

// middleware 

app.use(cors())
app.use(express.json())
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.t2y7ypa.mongodb.net/?appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db=client.db("zap_shift_db");
    const parcelCollection=db.collection("parcels");

  app.post('/parcels', async (req, res) => {
  const doc = req.body;
  doc.createdAt=new Date();
  doc.PaymentStatus="unpaid";
  const result = await parcelCollection.insertOne(doc);
  res.send(result);
  });

  app.get('/parcels',async(req,res)=>{
       
       const quary={};
       const {email}=req.query;
       if(email){
         quary.senderEmail=email;
       }
       const optional={ sort: { "createdAt": -1 } }
       const cursor=parcelCollection.find(quary,optional);
       const result=await cursor.toArray();
       res.send(result);
  })

  app.delete('/parcels/:id',async(req,res)=>{
      
       const id=req.params.id;
        const query = { _id: new ObjectId(id) };
       const result = await parcelCollection.deleteOne(query);
        res.send(result);
  })

app.post('/create-checkout-session', async (req, res) => {
  const paymentInfo = req.body;

  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(Number(paymentInfo.cost) * 100),
          product_data: {
            name: paymentInfo.parcelName,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: paymentInfo.senderEmail,
    mode: 'payment',
    metadata: {
      parcelId: paymentInfo.parcelId,
    },
    success_url: `${process.env.SITE_DOMAIN}/dashboard`,
    cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel`,
  });

  res.send({ url: session.url });
});


    
   
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    
  }
}
run().catch(console.dir);




app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})