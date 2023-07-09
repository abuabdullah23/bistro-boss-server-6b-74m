const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
require('dotenv').config()
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());

// verify jwt
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];

    // verify a token symmetric
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}


// ========================= Mongo DB ================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_SECRET}@cluster0.ufrxsge.mongodb.net/?retryWrites=true&w=majority`;

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
        // await client.connect();

        // create db
        const usersCollection = client.db('bistroBoss').collection('users');
        const menuCollection = client.db('bistroBoss').collection('menu');
        const reviewsCollection = client.db('bistroBoss').collection('reviews');
        const cartCollection = client.db('bistroBoss').collection('carts');
        const paymentCollection = client.db('bistroBoss').collection('payments');


        // jwt
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })

        // Warning: use VerifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }
            next();
        }
        /***
         * 0. do not show secure links to those who should not see the links
         * 1. use jwt token: verifyJWT
         * 2. use verifyAdmin middleware
        */

        // admin api
        // security layer: verifyJWT, is email same, check Admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })


        // user Related API
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists.' })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        app.delete('/users/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })

        // get data with verify admin
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        })

        // Menu Related API
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        })

        // get menu item by admin
        app.get('/dashboard/update-menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result);
        })

        // update menu method by admin
        app.put('/dashboard/update-menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const updatedItem = req.body;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const item = {
                $set: {
                    name: updatedItem.name,
                    price: updatedItem.price,
                    category: updatedItem.category,
                    recipe: updatedItem.recipe
                }
            }
            const result = await menuCollection.updateOne(filter, item, options);
            res.send(result);
        })

        app.post('/menu', async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem);
            res.send(result);
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })


        // review related API
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        })

        // cart collection Api
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([])
            }

            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }

            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/carts', async (req, res) => {
            const foodItem = req.body;
            const result = await cartCollection.insertOne(foodItem);
            res.send(result);
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        })

        // create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100); // fixed invalid integer
            console.log(price, amount)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        // payment related api
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } };
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({ insertResult, deleteResult });
        })

        // ‍Admin State Api state
        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce((sum, payment) => sum + payment.price, 0);

            res.send({
                revenue,
                users,
                products,
                orders
            })
        })


        /**
         * ---------------------
         * Bangla System
         * ---------------------
         * 1. load all payments
         * 2. for each payment, get the menuItems array
         * 3. for each item in the menuItems array get the menuItem for the menu collection
         * 4. put them in an array: allOrderedItems
         * 5. separate allOrderedItems by category using filter
         * 6. now get the quantity by using length: pizzas.length
         * 7. for each category use reduce to get the total amount spent on the category
         * 
        */

        // Best System
        app.get('/order-stats', async (req, res) => {
            try {
                const pipeline = [
                    {
                        $lookup: {
                            from: 'menu',
                            localField: 'menuItems',
                            foreignField: '_id',
                            as: 'menuItemsData'
                        }
                    },
                    {
                        $unwind: '$menuItemsData'
                    },
                    {
                        $group: {
                            _id: '$menuItemsData.category',
                            count: { $sum: 1 },
                            totalPrice: { $sum: '$menuItemsData.price' }
                        }
                    }
                ];

                const result = await paymentCollection.aggregate(pipeline).toArray();
                console.log('Aggregation result:', result); // Debugging statement

                res.send(result);
            } catch (error) {
                console.error('Error occurred during aggregation:', error);
                res.status(500).send('An error occurred during aggregation');
            }
        });













        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// ========================= Mongo DB ================================



app.get('/', (req, res) => {
    res.send('Bistro server is Running')
})

app.listen(port, () => {
    console.log('Bistro server is Running on port: ', port);
})