const express = require("express");
var router = express.Router();
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();

// ================= GEMINI =================
const genAI = new GoogleGenerativeAI("AIzaSyAKAS2QvTv8CxBnE3PqSLuq4FW5AjLDWsI");

// Latest working model
const aiModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
});

// ================= EXPRESS =================
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= MONGODB =================
mongoose.connect("mongodb+srv://corestone:tmsMMdIuISuD1ukw@cluster0.kmnbrpu.mongodb.net/LoadApp")
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

// ================= SCHEMAS =================
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'driver', 'owner'], default: 'driver' } // Added 'owner'
});

const loadSchema = new mongoose.Schema({
    cargoName: String,
    weight: Number,
    origin: String,
    destination: String,
    status: {
        type: String,
        enum: ['Pending','Assigned','Picked Up','Delivered'],
        default: 'Pending'
    },

    ownerEmail: String, // Tracks who created the load
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    assignedVehicle: String,
    deliveryFee: Number ,       // final price paid to driver
    suggestedPrice: Number , 
    ownerPrice: Number    
});
const vehicleSchema = new mongoose.Schema({
    truckNumber: String,

    type: String,

    capacity: Number,

    currentLocation: String,

    status: {
        type: String,
        default: 'Available'
    },

    ownerEmail: String,

    // DRIVER DETAILS
    driverName: String,

    driverEmail: String,

    driverPhone: String,

    // PERFORMANCE
    rating: {
        type: Number,
        default: 5
    },

    successfulDeliveries: {
        type: Number,
        default: 0
    },

    failedDeliveries: {
        type: Number,
        default: 0
    },

    totalTrips: {
        type: Number,
        default: 0
    },

    // LIVE STATUS
    lastActive: {
        type: Date,
        default: Date.now
    },

    availability: {
        type: String,
        default: 'Online'
    }
});

const User = mongoose.model("user", userSchema);
const Load = mongoose.model("loads", loadSchema);
const Vehicle = mongoose.model("vehicles", vehicleSchema);

// ================= AUTH MIDDLEWARE =================
const adminAuth = async (req, res, next) => {
    const email = req.query.email || req.body.adminEmail;
    const user = await User.findOne({ email });

    if (user && user.role === 'admin') {
        next();
    } else {
        res.status(403).send("Access Denied: Admin Rights Required");
    }
};

// ================= AUTH ROUTES =================

app.get("/", (req, res) => res.render("login", { status: "ok" }));

app.get("/signup", (req, res) => res.render("registration"));

app.post("/create-user", async (req, res) => {
    try {

        const hashedPassword = await bcrypt.hash(req.body.password, 10);

        const newUser = new User({
            email: req.body.email,
            password: hashedPassword,
            role: req.body.role || 'driver'
        });

        await newUser.save();

        res.redirect("/");

    } catch (error) {
        res.status(500).send("Error creating account: " + error.message);
    }
});

const roleAuth = (roles) => async (req, res, next) => {
    const email = req.query.email || req.body.adminEmail;
    const user = await User.findOne({ email });

    if (user && roles.includes(user.role)) {
        req.user = user; // Pass user object to next route
        next();
    } else {
        res.status(403).send("Access Denied: Insufficient Permissions");
    }
};

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        let route = 'driver-portal';
        if(user.role === 'admin') route = 'admin-dashboard';
        if(user.role === 'owner') route = 'owner-dashboard';
        
        res.redirect(`/${route}?email=${user.email}`);
    } else {
        res.render("login", { status: "Invalid Credentials" });
    }
});

// ================= LOGISTICS ROUTES =================

// ================= OWNER DASHBOARD =================
app.get("/owner-dashboard", async (req, res) => {
    const email = req.query.email;
    const user = await User.findOne({ email });

    if (!user || user.role !== 'owner') return res.redirect("/");

   const myVehicles = await Vehicle.find({ ownerEmail: email });
   
    const myLoads = await Load.find({ ownerEmail: email });
    res.render("ownerDashboard", { user, myVehicles, myLoads });
});

app.post("/set-owner-price", async (req, res) => {

    const { loadId, ownerPrice, ownerEmail } = req.body;

    await Load.findByIdAndUpdate(loadId, {
        ownerPrice: ownerPrice
    });

    res.redirect(`/owner-dashboard?email=${ownerEmail}`);

});
// ================= DRIVER PORTAL =================
app.get("/driver-portal", async (req, res) => {
    const email = req.query.email;
    const user = await User.findOne({ email });

    if (!user || user.role !== 'driver') return res.redirect("/");

    // Drivers see loads assigned specifically to them
    const myLoads = await Load.find({ assignedDriver: user._id });
     const myVehicles = await Vehicle.find({ driverEmail: email });

    res.render("driverPortal", { user, myLoads, myVehicles, msg: req.query.msg });
});
app.post("/add-vehicle", roleAuth(['driver', 'admin']), async (req, res) => {
    const driver = await User.findOne({
    email: req.body.adminEmail
});

await new Vehicle({

    truckNumber: req.body.truckNumber,

    capacity: req.body.capacity,

    driverEmail: req.body.adminEmail,

    driverName: driver?.email || "Driver",

    driverPhone: req.body.driverPhone || "N/A",

    status: "Available",

    availability: "Online"

}).save();
    
    const redirectRoute = req.user.role === 'admin' ? 'admin-dashboard' : 'driver-portal';
    res.redirect(`/${redirectRoute}?email=${req.body.adminEmail}`);
});

app.get("/driver/pickup-load/:loadId", async (req, res) => {

    await Load.findByIdAndUpdate(
        req.params.loadId,
        {
            status: "Picked Up"
        }
    );

    await Vehicle.findOneAndUpdate(
        {
            driverEmail: req.query.email
        },
        {
            status: "On Route",
            lastActive: new Date()
        }
    );

    res.redirect(
        `/driver-portal?email=${req.query.email}&msg=pickup`
    );
});

app.get("/driver/deliver-load/:loadId", async (req, res) => {

     // UPDATE LOAD
    const load = await Load.findByIdAndUpdate(
        req.params.loadId,
        {
            status: "Delivered"
        },
        { new: true }
    );

    // UPDATE DRIVER VEHICLE STATS
    await Vehicle.findOneAndUpdate(
        {
            driverEmail: req.query.email
        },
        {
            $inc: {
                successfulDeliveries: 1,
                totalTrips: 1
            },

            $set: {
                status: "Available",
                lastActive: new Date()
            }
        }
    );
       const vehicle = await Vehicle.findOne({
        driverEmail: req.query.email
    });

    if(vehicle){

        vehicle.rating =
            vehicle.totalTrips > 0
            ? (
                (vehicle.successfulDeliveries /
                vehicle.totalTrips) * 5
              ).toFixed(1)
            : 5;

        await vehicle.save();
    }

    res.redirect(`/driver-portal?email=${req.query.email}&msg=delivered`);
});
// ================= DRIVER: ACCEPT & ROUTE =================
app.get("/driver/accept-load/:loadId", async (req, res) => {
    const load = await Load.findByIdAndUpdate(req.params.loadId, { status: 'Picked Up' });
    // This triggers the view where they see the Leaflet map
    res.redirect(`/driver-portal?email=${req.query.email}`);
});
// ================= SUPER ADMIN ROUTE =================
app.get("/admin-dashboard", async (req, res) => {
    try {

        // Loads waiting for admin action
        const pendingLoads = await Load.find({ status: "Pending" });

        // Loads already dispatched / active
        const activeLoads = await Load.find({ status: { $ne: "Pending" } });

        const vehicles = await Vehicle.find({})
.sort({
    successfulDeliveries: -1,
    rating: -1
});
        const drivers = await User.find({ role: "driver" });

        res.render("adminDashboard", {
            pendingLoads,
            activeLoads,
            vehicles,
            drivers,
            adminEmail: req.query.email
        });

    } catch (error) {
        console.error("Error loading admin dashboard:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/assign-load", adminAuth, async (req, res) => {

    await Load.findByIdAndUpdate(req.body.loadId, {
        assignedDriver: req.body.driverId,
        status: "Assigned"
    });

    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);

});

app.post("/add-load", adminAuth, async (req, res) => {

    const newLoad = new Load({
        cargoName: req.body.cargoName,
        weight: req.body.weight,
        origin: req.body.origin,
        destination: req.body.destination,
        ownerEmail: req.body.ownerEmail,
        deliveryFee: req.body.deliveryFee || 0,
        status: "Pending"
    });

    await newLoad.save();

    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);

});
// ================= OWNER: CREATE LOAD =================
app.post("/owner/create-load", async (req, res) => {
    try {
        const newLoad = new Load({
            ...req.body,
            status: 'Pending',
            deliveryFee: req.body.deliveryFee // Initial state for Admin to see
        });
        await newLoad.save();
        res.redirect(`/owner-dashboard?email=${req.body.ownerEmail}`);
    } catch (err) {
        res.status(500).send("Error creating load");
    }
});


// ================= AI DISPATCHER =================

app.get("/ai-recommend/:loadId", adminAuth, async (req, res) => {

    try {

        const load = await Load.findById(req.params.loadId);

        if (!load) {
            return res.status(404).json({ error: "Load not found" });
        }

        const vehicles = await Vehicle.find({
            status: 'Available',
            capacity: { $gte: load.weight }
        });

        if (!vehicles.length) {
            return res.json({
                error: "No available vehicles with sufficient capacity."
            });
        }

        console.log("Load:", load);
        console.log("Vehicles:", vehicles);

        const prompt = `
You are a logistics AI dispatcher.

LOAD:
${load.cargoName} (${load.weight}kg)

ROUTE:
${load.origin} to ${load.destination}

AVAILABLE VEHICLES:
${vehicles.map(v => `${v.truckNumber} (${v.capacity}kg)`).join(", ")}

Return ONLY valid JSON:

{
"bestVehicle": "TruckNumber",
"distance": "XX km",
"routePlan": "Best highway route",
"score": 95,
"reason": "Why this vehicle is best"
}
`;

        const result = await aiModel.generateContent(prompt);

        const text = result.response.text();

        console.log("AI RAW RESPONSE:", text);

        const cleaned = text.replace(/```json|```/g, "").trim();

        let data;

        try {
            data = JSON.parse(cleaned);
        } catch (err) {

            console.log("Invalid JSON from AI:", cleaned);

            return res.json({
                error: "AI returned invalid JSON",
                raw: cleaned
            });

        }

        res.json(data);

    } catch (e) {

        console.error("AI Error:", e);

        res.status(500).json({
            error: "AI Dispatcher failed to process."
        });

    }

});

// ================= AI price suggestion =================
app.get("/ai-price/:loadId", async (req, res) => {

    try {

        const load = await Load.findById(req.params.loadId);

        if (!load) {
            return res.json({ error: "Load not found" });
        }

        const prompt = `
You are a logistics pricing AI.

Calculate delivery price.

Cargo Weight: ${load.weight} kg
Route: ${load.origin} to ${load.destination}

Rules:
- Base price: ₹20 per km
- Weight surcharge: ₹2 per kg

Return JSON:

{
 "suggestedPrice": 4500,
 "reason": "Distance and weight calculation"
}
`;

        const result = await aiModel.generateContent(prompt);

        const text = result.response.text();

        const cleaned = text.replace(/```json|```/g, "").trim();

        const data = JSON.parse(cleaned);

        await Load.findByIdAndUpdate(load._id, {
            suggestedPrice: data.suggestedPrice
        });

        res.json(data);

    } catch (err) {

        console.error(err);

        res.json({ error: "AI price calculation failed" });

    }

});

// ================= ASSIGN LOAD =================

app.post("/assign-load", adminAuth, async (req, res) => {

    await Load.findByIdAndUpdate(req.body.loadId, {
        assignedDriver: req.body.driverId,
        status: 'Assigned'
    });

    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);

});

// ================= SERVER =================

app.listen(3000, () =>
    console.log("Server running on http://localhost:3000")
);

module.exports = router;