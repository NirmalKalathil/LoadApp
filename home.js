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
    status: { type: String, default: 'Pending' },
    ownerEmail: String, // Tracks who created the load
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    assignedVehicle: String
});
const vehicleSchema = new mongoose.Schema({
    truckNumber: String,
    type: String,
    capacity: Number,
    currentLocation: String,
    status: { type: String, default: 'Available' },
    ownerEmail: String // <--- ADD THIS LINE
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

    // Owners only see their own registered vehicles
    const myVehicles = await Vehicle.find({ ownerEmail: email });

    res.render("ownerDashboard", { user, myVehicles });
});

// ================= DRIVER PORTAL =================
app.get("/driver-portal", async (req, res) => {
    const email = req.query.email;
    const user = await User.findOne({ email });

    if (!user || user.role !== 'driver') return res.redirect("/");

    // Drivers see loads assigned specifically to them
    const myLoads = await Load.find({ assignedDriver: user._id });

    res.render("driverPortal", { user, myLoads });
});
app.post("/add-vehicle", roleAuth(['owner', 'admin']), async (req, res) => {
    await new Vehicle({
        truckNumber: req.body.truckNumber,
        capacity: req.body.capacity,
        ownerEmail: req.body.adminEmail // Link vehicle to owner
    }).save();
    
    const redirectRoute = req.user.role === 'admin' ? 'admin-dashboard' : 'owner-dashboard';
    res.redirect(`/${redirectRoute}?email=${req.body.adminEmail}`);
});

// ================= SUPER ADMIN ROUTE =================
app.get("/admin-dashboard", async (req, res) => {
    try {
        // 1. Fetch all the data the dashboard needs
        const loads = await Load.find({}); 
        const vehicles = await Vehicle.find({});
        
        // 2. THIS IS THE MISSING PIECE: Fetch only users with the 'driver' role
        const drivers = await User.find({ role: 'driver' }); 

        // 3. Pass all these variables to the EJS file
        res.render("adminDashboard", { 
            loads: loads, 
            vehicles: vehicles, 
            drivers: drivers, // Make sure this matches the variable name in your EJS
            adminEmail: req.query.email 
        });
    } catch (error) {
        console.error("Error loading admin dashboard:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/add-load", adminAuth, async (req, res) => {

    await new Load(req.body).save();

    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);

});
// ================= OWNER: CREATE LOAD =================
app.post("/owner/create-load", async (req, res) => {
    try {
        const newLoad = new Load({
            ...req.body,
            status: 'Pending' // Initial state for Admin to see
        });
        await newLoad.save();
        res.redirect(`/owner-dashboard?email=${req.body.ownerEmail}`);
    } catch (err) {
        res.status(500).send("Error creating load");
    }
});

// ================= DRIVER: ACCEPT & ROUTE =================
app.get("/driver/accept-load/:loadId", async (req, res) => {
    const load = await Load.findByIdAndUpdate(req.params.loadId, { status: 'In Transit' });
    // This triggers the view where they see the Leaflet map
    res.redirect(`/driver-portal?email=${req.query.email}`);
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