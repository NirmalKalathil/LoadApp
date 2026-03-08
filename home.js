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
    role: { type: String, enum: ['admin', 'driver'], default: 'driver' }
});

const loadSchema = new mongoose.Schema({
    cargoName: String,
    weight: Number,
    origin: String,
    destination: String,
    status: { type: String, default: 'Pending' },
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    assignedVehicle: String
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

app.post("/login", async (req, res) => {

    const user = await User.findOne({ email: req.body.email });

    if (user && await bcrypt.compare(req.body.password, user.password)) {

        const route = user.role === 'admin' ? 'admin-dashboard' : 'driver-portal';

        res.redirect(`/${route}?email=${user.email}`);

    } else {

        res.render("login", { status: "Invalid Credentials" });

    }

});

// ================= LOGISTICS ROUTES =================

app.get("/admin-dashboard", adminAuth, async (req, res) => {

    const loads = await Load.find({}).populate('assignedDriver');
    const drivers = await User.find({ role: 'driver' });
    const vehicles = await Vehicle.find({});

    res.render("adminDashboard", { loads, drivers, vehicles, adminEmail: req.query.email });

});

app.post("/add-vehicle", async (req, res) => {

    await new Vehicle({
        truckNumber: req.body.truckNumber,
        capacity: req.body.capacity
    }).save();

    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);

});

app.post("/add-load", adminAuth, async (req, res) => {

    await new Load(req.body).save();

    res.redirect(`/admin-dashboard?email=${req.body.adminEmail}`);

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