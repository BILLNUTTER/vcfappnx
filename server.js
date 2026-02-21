import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined");
  process.exit(1);
}

if (!ADMIN_KEY) {
  console.error("❌ ADMIN_KEY is not defined");
  process.exit(1);
}

const SUPPORT_LINK = "https://whatsapp.com/channel/0029Vb6b864Id7nIEgOrMe24";

let db;
let contactsCollection;
let broadcastCollection;

const client = new MongoClient(MONGODB_URI);

/* ================= DATABASE ================= */
async function connectDB() {
  try {
    await client.connect();
    db = client.db("nxvcfapp");

    contactsCollection = db.collection("contacts");
    broadcastCollection = db.collection("broadcasts");

    await contactsCollection.createIndex({ phone_number: 1 }, { unique: true });

    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());

/* ================= HEALTH ================= */
app.get("/health", (_, res) => {
  res.json({ status: "OK", service: "NUTTERX VCF API" });
});

/* ================= CONTACTS ================= */

/* COUNT */
app.get("/api/contacts/count", async (_, res) => {
  try {
    const count = await contactsCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch count" });
  }
});

/* GET ALL */
app.get("/api/contacts", async (_, res) => {
  try {
    const contacts = await contactsCollection
      .find({})
      .sort({ created_at: 1 })
      .limit(250)
      .toArray();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

/* ✅ DOWNLOAD VCF FILE */
app.get("/api/contacts/download", async (_, res) => {
  try {
    const contacts = await contactsCollection.find({}).toArray();

    if (!contacts.length) {
      return res.status(404).json({ error: "No contacts available" });
    }

    let vcfContent = "";

    contacts.forEach((contact) => {
      const displayName = `${contact.name}🔥`; // 👈 Emoji added here

      vcfContent += `BEGIN:VCARD\n`;
      vcfContent += `VERSION:3.0\n`;
      vcfContent += `FN:${displayName}\n`;
      vcfContent += `N:${displayName};;;;\n`; // Better compatibility (Android/iPhone)
      vcfContent += `TEL;TYPE=CELL:${contact.phone_number}\n`;
      vcfContent += `END:VCARD\n\n`;
    });

    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=NUTTERX.vcf");

    res.send(vcfContent);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate VCF file" });
  }
});


/* CREATE (REGISTER) */
app.post("/api/contacts", async (req, res) => {
  try {
    const { name, phone_number } = req.body;
    if (!name || !phone_number) 
      return res.status(400).json({ error: "Name and phone number are required" });

    const cleanedPhone = phone_number.replace(/\D/g, "");

    if (cleanedPhone.length < 10 || cleanedPhone.length > 15)
      return res.status(400).json({ error: "Invalid phone number (10–15 digits)" });

    // 🔒 Blocked numbers
    const blockedNumbers = ["254713380848", "254712345678"];
    if (blockedNumbers.includes(cleanedPhone)) {
      return res.status(403).json({ error: "This number is restricted from registering." });
    }

    const newContact = { name, phone_number: cleanedPhone, link: SUPPORT_LINK, created_at: new Date() };

    await contactsCollection.insertOne(newContact);
    res.status(201).json({ message: "Contact saved successfully", contact: newContact });
  } catch (err) {
    if (err.code === 11000) 
      return res.status(409).json({ error: "Phone number already registered" });
    res.status(500).json({ error: "Failed to save contact" });
  }
});

/* USER UPDATE */
app.put("/api/contacts", async (req, res) => {
  try {
    const { old_phone_number, new_name, new_phone_number } = req.body;
    if (!old_phone_number || (!new_name && !new_phone_number))
      return res.status(400).json({ error: "Required data missing contact dev Nutterx +254713881613 to update for you." });

    const update = {};
    if (new_name) update.name = new_name;
    if (new_phone_number) {
      const cleanedPhone = new_phone_number.replace(/\D/g, "");
      if (cleanedPhone.length < 10 || cleanedPhone.length > 15)
        return res.status(400).json({ error: "Invalid phone number" });
      update.phone_number = cleanedPhone;
    }

    const result = await contactsCollection.updateOne({ phone_number: old_phone_number }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: "Contact not found" });

    const updatedContact = await contactsCollection.findOne({ phone_number: update.phone_number || old_phone_number });
    res.json({ message: "Contact updated successfully", contact: updatedContact });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Phone number already registered" });
    res.status(500).json({ error: "Failed to update contact" });
  }
});

/* ================= ADMIN ================= */

/* LOGIN */
app.post("/api/admin/login", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "Admin key required" });
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "Invalid admin key" });
  res.json({ success: true });
});

/* AUTH MIDDLEWARE */
function adminAuth(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/* ADMIN - CREATE BROADCAST */
app.post("/api/admin/broadcast", adminAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const post = { message, created_at: new Date() };
    await broadcastCollection.insertOne(post);
    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: "Failed to send broadcast" });
  }
});

/* ADMIN - GET ALL CONTACTS */
app.get("/api/admin/contacts", adminAuth, async (_, res) => {
  try {
    const contacts = await contactsCollection.find({}).sort({ created_at: 1 }).toArray();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

/* ADMIN - UPDATE CONTACT */
app.put("/api/admin/contacts/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone_number } = req.body;
    if (!name && !phone_number) return res.status(400).json({ error: "Nothing to update" });

    const update = {};
    if (name) update.name = name;
    if (phone_number) {
      const cleanedPhone = phone_number.replace(/\D/g, "");
      if (cleanedPhone.length < 10 || cleanedPhone.length > 15)
        return res.status(400).json({ error: "Invalid phone number" });
      update.phone_number = cleanedPhone;
    }

    const result = await contactsCollection.updateOne({ _id: new ObjectId(id) }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: "Contact not found" });

    const updatedContact = await contactsCollection.findOne({ _id: new ObjectId(id) });
    res.json({ message: "Contact updated successfully", contact: updatedContact });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Phone number already registered" });
    res.status(500).json({ error: "Failed to update contact" });
  }
});

/* ADMIN - DELETE CONTACT */
app.delete("/api/admin/contacts/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await contactsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Contact not found" });
    res.json({ message: "Contact deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

/* GET LATEST BROADCAST (USERS) */
app.get("/api/broadcast/latest", async (_, res) => {
  try {
    const post = await broadcastCollection.find({}).sort({ created_at: -1 }).limit(1).toArray();
    res.json({ message: post[0] || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch broadcast" });
  }
});

/* ================= START SERVER ================= */
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 NUTTERX VCF API running on port ${PORT}`);
  });
});
