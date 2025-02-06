require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 7860;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mikmc55:vD6kL6jADy4Mxl5B@hy0.av11l.mongodb.net/?retryWrites=true&w=majority&appName=hy0';

if (!MONGODB_URI.startsWith('mongodb://') && !MONGODB_URI.startsWith('mongodb+srv://')) {
    console.error('Invalid MongoDB URI. Must start with mongodb:// or mongodb+srv://');
    process.exit(1);
}

let db;
let client;

async function connectDB() {
    try {
        const options = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 50,
            wtimeoutMS: 2500,
            retryWrites: true
        };

        console.log('Connecting to MongoDB...');
        client = await MongoClient.connect(MONGODB_URI, options);
        db = client.db('iptv_manager');
        
        // Test database and collections
        const dbs = await client.db().admin().listDatabases();
        console.log('Available databases:', dbs.databases.map(db => db.name));

        // Ensure collections exist
        const requiredCollections = ['users', 'connections', 'sessions'];
        for (const collName of requiredCollections) {
            const exists = await db.listCollections({ name: collName }).hasNext();
            if (!exists) {
                console.log(`Creating collection: ${collName}`);
                await db.createCollection(collName);
            }
        }

        // Create necessary indexes
        await db.collection('connections').createIndex({ userId: 1 });
        await db.collection('users').createIndex({ username: 1 }, { unique: true });

        console.log('MongoDB connected and initialized successfully');
        return true;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        return false;
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || '11223344',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGODB_URI,
        collectionName: 'sessions',
        ttl: 24 * 60 * 60
    })
}));

// Auth check middleware
app.use((req, res, next) => {
    const protectedPages = ['/hideme/dashboard.html', '/hideme/admin.html'];
    const loginPage = '/hideme/index.html';
    
    if (!req.session.userId && protectedPages.includes(req.path)) {
        return res.redirect(loginPage);
    }
    
    if (req.session.userId && req.path === loginPage) {
        return res.redirect('/hideme/dashboard.html');
    }
    
    next();
});

app.use(express.static('public'));

// Auth middleware
const auth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};
// Test route for database status
// Test route for database status
app.get('/api/dbstatus', auth, async (req, res) => {
    try {
        const collections = await db.listCollections().toArray();
        console.log('Current Collections:', collections);
        console.log('Current User ID:', req.session.userId);

        // Get detailed counts and data
        const dbStatus = {
            collections: collections,
            connectionsCount: await db.collection('connections').countDocuments(),
            usersCount: await db.collection('users').countDocuments(),
            sessionsCount: await db.collection('sessions').countDocuments(),
            userId: req.session.userId,
            userConnections: await db.collection('connections')
                .find({ userId: req.session.userId.toString() })
                .toArray(),
            // Add collection details
            collectionDetails: {
                users: await db.collection('users').find({}).toArray(),
                connections: await db.collection('connections').find({}).toArray(),
                indexes: {
                    users: await db.collection('users').indexes(),
                    connections: await db.collection('connections').indexes()
                }
            }
        };

        // Log the entire database status
        console.log('Database Status:', JSON.stringify(dbStatus, null, 2));

        res.json(dbStatus);
    } catch (error) {
        console.error('Database status error:', error);
        res.status(500).json({ 
            error: 'Failed to get database status', 
            details: error.message,
            stack: error.stack
        });
    }
});

// API Routes
app.post('/api/admin/update', auth, async (req, res) => {
    try {
        const { newUsername, newPassword, currentPassword } = req.body;
        const admin = await db.collection('users').findOne({ _id: req.session.userId });

        if (!admin || !(await bcrypt.compare(currentPassword, admin.password))) {
            return res.status(401).json({ error: 'Invalid current password' });
        }

        const updateData = {};
        if (newUsername) updateData.username = newUsername;
        if (newPassword) updateData.password = await bcrypt.hash(newPassword, 10);

        await db.collection('users').updateOne(
            { _id: req.session.userId },
            { $set: updateData }
        );

        req.session.destroy();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Update failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await db.collection('users').findOne({ username });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (isValidPassword) {
            req.session.userId = user._id;
            const connections = await db.collection('connections')
                .find({ userId: user._id.toString() })
                .sort({ createdAt: -1 })
                .toArray();
            res.json({ success: true, connections });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/connections', auth, async (req, res) => {
    try {
        console.log('Current user ID:', req.session.userId);
        
        // Check if database is connected
        if (!db) {
            console.error('Database not connected');
            return res.status(500).json({ error: 'Database not connected' });
        }

        // Verify collection exists
        const collections = await db.listCollections({ name: 'connections' }).toArray();
        if (collections.length === 0) {
            console.log('Creating connections collection');
            await db.createCollection('connections');
            return res.json([]);
        }

        // Get connections with debug info
        const query = { userId: req.session.userId.toString() };
        console.log('Looking for connections with query:', query);

        const connections = await db.collection('connections')
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        console.log(`Found ${connections.length} connections for user ${req.session.userId}`);

        res.json(connections);
    } catch (error) {
        console.error('Error in /api/connections:', error);
        res.status(500).json({ error: 'Failed to fetch connections' });
    }
});

app.post('/api/connections', auth, async (req, res) => {
    try {
        const newConnection = {
            userId: req.session.userId.toString(),
            expireDate: req.body.expireDate || null,
            createdAt: new Date(),
            updatedAt: new Date(),
            name: req.body.name,
            targetUrl: req.body.targetUrl,
            targetUsername: req.body.targetUsername,
            targetPassword: req.body.targetPassword,
            iptvUsername: req.body.iptvUsername,
            iptvPassword: req.body.iptvPassword
        };
        
        console.log('Creating new connection:', { ...newConnection, _id: undefined });
        const result = await db.collection('connections').insertOne(newConnection);
        console.log('Connection created with ID:', result.insertedId);
        
        res.json({ ...newConnection, _id: result.insertedId });
    } catch (error) {
        console.error('Error creating connection:', error);
        res.status(500).json({ error: 'Failed to add connection' });
    }
});
app.put('/api/connections/:id', auth, async (req, res) => {
    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date()
        };

        const result = await db.collection('connections').findOneAndUpdate(
            { 
                _id: new MongoClient.ObjectId(req.params.id), 
                userId: req.session.userId.toString()
            },
            { $set: updateData },
            { returnDocument: 'after' }
        );
        
        if (!result.value) {
            return res.status(404).json({ error: 'Connection not found' });
        }
        
        res.json(result.value);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update connection' });
    }
});

app.delete('/api/connections/:id', auth, async (req, res) => {
    try {
        const result = await db.collection('connections').deleteOne({
            _id: new MongoClient.ObjectId(req.params.id),
            userId: req.session.userId.toString()
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Connection not found' });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete connection' });
    }
});

// IPTV Routes
app.get('/xmltv.php', async (req, res) => {
    try {
        const { username, password } = req.query;
        const connection = await db.collection('connections').findOne({
            iptvUsername: username,
            iptvPassword: password
        });

        if (!connection) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const targetUrl = `${connection.targetUrl}/xmltv.php?username=${connection.targetUsername}&password=${connection.targetPassword}`;
        const headers = {
            'accept': 'application/xml,text/xml,*/*',
            'accept-language': req.headers['accept-language'],
            'user-agent': req.headers['user-agent']
        };

        const response = await fetch(targetUrl, { 
            headers,
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`Target server error: ${response.status}`);
        }

        res.status(response.status);
        const responseHeaders = {
            'Content-Type': 'application/xml; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        };

        Object.entries(responseHeaders).forEach(([key, value]) => {
            if (value) res.setHeader(key, value);
        });

        response.body.pipe(res);
    } catch (error) {
        if (!res.headersSent) {
            res.status(502).json({ error: 'Failed to fetch XMLTV data' });
        }
    }
});

app.get('/player_api.php', async (req, res) => {
    try {
        const { username, password, ...otherParams } = req.query;

        if (!username || !password) {
            return res.status(401).json({
                user_info: { auth: 0, status: "Active", error: "Missing credentials" }
            });
        }

        const connection = await db.collection('connections').findOne({
            iptvUsername: username,
            iptvPassword: password
        });

        if (!connection) {
            return res.status(401).json({
                user_info: { auth: 0, status: "Active", error: "Invalid credentials" }
            });
        }

        if (Object.keys(otherParams).length === 0) {
            const serverUrl = new URL(req.protocol + '://' + req.get('host'));
            let expTimestamp = connection.expireDate ? 
                Math.floor(new Date(connection.expireDate).getTime() / 1000) : 
                Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

            return res.json({
                user_info: {
                    username: username,
                    password: password,
                    message: "Successfully logged in",
                    auth: 1,
                    status: "Active",
                    exp_date: expTimestamp,
                    is_trial: "0",
                    active_cons: "0",
                    created_at: Math.floor(connection.createdAt?.getTime() / 1000) || Math.floor(Date.now() / 1000),
                    max_connections: "1",
                    allowed_output_formats: ["m3u8", "ts"]
                },
                server_info: {
                    url: serverUrl.hostname,
                    port: serverUrl.port || "80",
                    https_port: "443",
                    server_protocol: serverUrl.protocol.replace(":", ""),
                    rtmp_port: "0",
                    timezone: "America/New_York",
                    timestamp_now: Math.floor(Date.now() / 1000),
                    time_now: new Date().toISOString().replace('T', ' ').slice(0, 19)
                }
            });
        }

        const queryParams = new URLSearchParams({
            username: connection.targetUsername,
            password: connection.targetPassword,
            ...otherParams
        }).toString();

        const targetUrl = `${connection.targetUrl}/player_api.php?${queryParams}`;
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                'Accept': 'application/json',
                'Connection': 'keep-alive'
            },
            timeout: 10000
        });

        if (!response.ok) {
            throw new Error(`Target server error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(502).json({ 
            error: 'Failed to fetch content',
            status: 'error'
        });
    }
});

// Initialize admin user
async function initializeAdmin() {
    try {
        const adminExists = await db.collection('users').findOne({ username: process.env.ADMIN_USERNAME || 'admin' });
        if (!adminExists) {
            const defaultUsername = process.env.ADMIN_USERNAME || 'mikmc';
            const defaultPassword = process.env.ADMIN_PASSWORD || 'chinaski';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            
            await db.collection('users').insertOne({
                username: defaultUsername,
                password: hashedPassword,
                createdAt: new Date(),
                isAdmin: true
            });
            console.log('Admin user initialized');
        }
    } catch (error) {
        console.error('Error initializing admin:', error);
        throw error;
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    try {
        await client.close();
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
});

// Start server
async function startServer() {
    const dbConnected = await connectDB();
    if (!dbConnected) {
        console.error('Failed to connect to database. Exiting...');
        process.exit(1);
    }
    await initializeAdmin();
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

// Start server with error handling
startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
