
const express = require("express");
var router = express.Router();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();

// 1. Initialize Gemini (Using latest model string to avoid 404s)
// Replace with your active API Key or use process.env.GEMINI_API_KEY
const genAI = new GoogleGenerativeAI("AIzaSyC-yQqxkDtV3Znwoj-tqTS1pDz_ydgXHUA");
// Change this line:
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 2. MongoDB Connection
mongoose.connect("mongodb+srv://corestone:tmsMMdIuISuD1ukw@cluster0.kmnbrpu.mongodb.net/LoadApp");

// 3. Schemas
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'driver'], default: 'driver' }
});

const loadSchema = new mongoose.Schema({
    cargoName: String,
    weight: Number,
    origin: String,
    destination: String,
    status: { type: String, default: 'Pending' },
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    assignedVehicle: String // Store truck number here for AI tracking
});

const vehicleSchema = new mongoose.Schema({
    truckNumber: String,
    type: String, 
    capacity: Number, 
    currentLocation: String,
    status: { type: String, default: 'Available' }
});

const User = mongoose.model("user", userSchema);
const Load = mongoose.model("loads", loadSchema);
const Vehicle = mongoose.model("vehicles", vehicleSchema);

// --- AUTH MIDDLEWARE ---
const adminAuth = async (req, res, next) => {
    const email = req.query.email || req.body.adminEmail;
    const user = await User.findOne({ email });
    if (user && user.role === 'admin') next();
    else res.status(403).send("Access Denied: Admin Rights Required");
};

// --- AUTH ROUTES ---

app.get("/", (req, res) => res.render("login", { status: "ok" }));

app.get("/signup", (req, res) => res.render("registration"));

// RESTORED: Create User / Registration Logic
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

app.post("/login", async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        const route = user.role === 'admin' ? 'admin-dashboard' : 'driver-portal';
        res.redirect(`/${route}?email=${user.email}`);
    } else {
        res.render("login", { status: "Invalid Credentials" });
    }
});

// --- LOGISTICS ROUTES ---

app.get("/admin-dashboard", adminAuth, async (req, res) => {
    const loads = await Load.find({}).populate('assignedDriver');
    const drivers = await User.find({ role: 'driver' });
    const vehicles = await Vehicle.find({});
    res.render("adminDashboard", { loads, drivers, vehicles, adminEmail: req.query.email });
});

app.post("/add-vehicle", async (req, res) => {
    await new Vehicle({
        truckNumber: req.body.truckNumber, // Ensure name="truckNumber" in EJS
        capacity: req.body.capacity       // Ensure name="capacity" in EJS
    }).save();
    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);
});

app.post("/add-load", adminAuth, async (req, res) => {
    await new Load(req.body).save();
    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);
});

// CONSOLIDATED AI LOGIC: Predicts Distance, Route, and Best Vehicle
app.get("/ai-recommend/:loadId", adminAuth, async (req, res) => {
    try {
        const load = await Load.findById(req.params.loadId);
        const vehicles = await Vehicle.find({ status: 'Available', capacity: { $gte: load.weight } });

        if (!vehicles.length) {
            return res.json({ error: "No available vehicles with sufficient capacity." });
        }

        const prompt = `As a Logistics AI, optimize this dispatch:
        LOAD: ${load.cargoName} (${load.weight}kg)
        ROUTE: ${load.origin} to ${load.destination}
        AVAILABLE VEHICLES: ${vehicles.map(v => `${v.truckNumber} (${v.capacity}kg)`).join(", ")}

        1. Calculate approximate shortest road distance (km).
        2. Identify the best vehicle based on weight capacity.
        3. Return ONLY valid JSON: 
        {"bestVehicle": "TruckNumber", "distance": "XX km", "routePlan": "Direct Path", "score": 95, "reason": "brief reason"}`;

       // Inside app.get("/ai-recommend/:loadId"...)
const result = await aiModel.generateContent(prompt);
const responseText = result.response.text().replace(/```json|```/g, "").trim();
res.json(JSON.parse(responseText));
    } catch (e) {
        console.error("AI Error:", e);
        res.status(500).json({ error: "AI Dispatcher failed to process." });
    }
});

app.post("/assign-load", adminAuth, async (req, res) => {
    await Load.findByIdAndUpdate(req.body.loadId, {
        assignedDriver: req.body.driverId,
        status: 'Assigned'
    });
    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
module.exports = router;
