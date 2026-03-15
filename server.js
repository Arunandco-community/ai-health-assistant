'use strict';

/* ── DNS fix: force Google DNS — bypasses Reliance router block ── */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ─────────────────────────── MONGOOSE SCHEMAS ─────────────────────────── */

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    age: { type: Number },
    gender: { type: String },
    location: { type: String },
    created_at: { type: Date, default: Date.now }
});

const FamilyMemberSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    relationship: { type: String, default: 'Self' },
    birth_date: { type: Date }
});

const VaccinationSchema = new mongoose.Schema({
    member_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    vaccine_name: { type: String, required: true },
    disease_prevented: { type: String },
    recommended_age: { type: String },
    due_age_weeks: { type: Number },
    due_date: { type: Date },
    status: { type: String, enum: ['Due', 'Completed', 'Overdue', 'Upcoming', 'pending'], default: 'Due' },
    reminder_sent: { type: Boolean, default: false },
    last_updated: { type: Date, default: Date.now }
});

const ChatHistorySchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conv_id: { type: String },
    timestamp: { type: Date, default: Date.now },
    user_message: { type: String },
    ai_response: { type: String },
    response_mode: { type: String }
});

const User = mongoose.model('User', UserSchema);
const FamilyMember = mongoose.model('FamilyMember', FamilyMemberSchema);
const Vaccination = mongoose.model('Vaccination', VaccinationSchema);
const ChatHistory = mongoose.model('ChatHistory', ChatHistorySchema);

/* ─────────────────────────── CONNECT MONGODB ─────────────────────────── */

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
}).catch(err => {
    console.error("❌  MongoDB connect failed:", err.message);
    console.error("    Check: Atlas Network Access (allow 0.0.0.0/0) + internet connection");
});

const db = mongoose.connection;
db.on('error', (err) => console.error('❌  MongoDB connection error:', err));
db.once('open', () => {
    const obscuredUri = process.env.MONGO_URI
        ? process.env.MONGO_URI.replace(/\/\/.*@/, '//****:****@')
        : 'Undefined';
    console.log('✅  MongoDB connection established successfully');
    console.log(`📊  Connected to: ${obscuredUri}`);
});
db.on('disconnected', () => console.log('⚠️  MongoDB disconnected. Attempting to reconnect...'));

process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('\n🛑  MongoDB connection closed due to app termination');
    process.exit(0);
});

/* ─────────────────────────── FULL VACCINE SCHEDULE ─────────────────────────── */

const VACCINE_SCHEDULE = [
    { vaccine_name: 'BCG', disease_prevented: 'Tuberculosis (TB)', recommended_age: 'At birth', due_age_weeks: 0 },
    { vaccine_name: 'OPV (Birth)', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: 'At birth', due_age_weeks: 0 },
    { vaccine_name: 'Hepatitis B (Birth)', disease_prevented: 'Hepatitis B liver disease', recommended_age: 'At birth', due_age_weeks: 0 },
    { vaccine_name: 'OPV-1', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'DPT-1', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'Hepatitis B-2', disease_prevented: 'Hepatitis B liver disease', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'Rotavirus-1', disease_prevented: 'Severe diarrhea / Gastroenteritis', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'PCV-1', disease_prevented: 'Pneumonia, Meningitis', recommended_age: '6 weeks', due_age_weeks: 6 },
    { vaccine_name: 'OPV-2', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'DPT-2', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'Hepatitis B-3', disease_prevented: 'Hepatitis B liver disease', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'Rotavirus-2', disease_prevented: 'Severe diarrhea / Gastroenteritis', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'PCV-2', disease_prevented: 'Pneumonia, Meningitis', recommended_age: '10 weeks', due_age_weeks: 10 },
    { vaccine_name: 'OPV-3', disease_prevented: 'Poliomyelitis (Polio)', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'DPT-3', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'Hepatitis B-4', disease_prevented: 'Hepatitis B liver disease', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'IPV', disease_prevented: 'Polio (injectable)', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'PCV-3', disease_prevented: 'Pneumonia, Meningitis', recommended_age: '14 weeks', due_age_weeks: 14 },
    { vaccine_name: 'Measles / MMR-1', disease_prevented: 'Measles, Mumps, Rubella', recommended_age: '9 months (36 weeks)', due_age_weeks: 36 },
    { vaccine_name: 'Vitamin A (1st)', disease_prevented: 'Vitamin A deficiency, Blindness', recommended_age: '9 months', due_age_weeks: 36 },
    { vaccine_name: 'Typhoid', disease_prevented: 'Typhoid fever', recommended_age: '9 months', due_age_weeks: 36 },
    { vaccine_name: 'Varicella-1', disease_prevented: 'Chickenpox', recommended_age: '12 months', due_age_weeks: 48 },
    { vaccine_name: 'Hepatitis A-1', disease_prevented: 'Hepatitis A liver disease', recommended_age: '12 months', due_age_weeks: 48 },
    { vaccine_name: 'MMR-2', disease_prevented: 'Measles, Mumps, Rubella (booster)', recommended_age: '15 months', due_age_weeks: 60 },
    { vaccine_name: 'DPT Booster', disease_prevented: 'Diphtheria, Pertussis, Tetanus', recommended_age: '18 months', due_age_weeks: 72 },
    { vaccine_name: 'Hepatitis A-2', disease_prevented: 'Hepatitis A liver disease', recommended_age: '18 months', due_age_weeks: 72 },
    { vaccine_name: 'Varicella-2', disease_prevented: 'Chickenpox (booster)', recommended_age: '4-6 years', due_age_weeks: 208 },
    { vaccine_name: 'Influenza (Annual)', disease_prevented: 'Influenza / Seasonal Flu', recommended_age: '6 months+ (annual)', due_age_weeks: 26 },
    { vaccine_name: 'HPV', disease_prevented: 'Human Papillomavirus / Cervical CA', recommended_age: '9-14 years', due_age_weeks: 468 },
    { vaccine_name: 'Meningococcal', disease_prevented: 'Bacterial Meningitis', recommended_age: '11-12 years', due_age_weeks: 572 },
    { vaccine_name: 'Tetanus (Adult)', disease_prevented: 'Tetanus (adult booster)', recommended_age: 'Every 10 years', due_age_weeks: 780 },
    { vaccine_name: 'COVID-19', disease_prevented: 'COVID-19 coronavirus', recommended_age: '12+ years', due_age_weeks: 624 },
    { vaccine_name: 'Shingles (Zoster)', disease_prevented: 'Shingles / Herpes Zoster', recommended_age: '50+ years', due_age_weeks: 2600 },
];

/* ─────────────────────────── HELPERS ─────────────────────────── */

function calcDueDate(birthDate, dueAgeWeeks) {
    if (!birthDate) return null;
    const d = new Date(birthDate);
    d.setDate(d.getDate() + dueAgeWeeks * 7);
    return d;
}

function deriveStatus(birthDate, dueAgeWeeks) {
    if (!birthDate) return 'Upcoming';
    const now = new Date();
    const ageWeeksNow = (now - new Date(birthDate)) / (7 * 24 * 3600 * 1000);
    if (ageWeeksNow < dueAgeWeeks - 4) return 'Upcoming';
    if (ageWeeksNow >= dueAgeWeeks - 4 && ageWeeksNow <= dueAgeWeeks + 4) return 'Due';
    if (ageWeeksNow > dueAgeWeeks + 4) return 'Overdue';
    return 'Upcoming';
}

function buildDefaultVaccines(member) {
    const ageWeeks = (member.age || 0) * 52;
    return VACCINE_SCHEDULE.map(v => {
        let status = 'Upcoming';
        if (ageWeeks >= v.due_age_weeks - 4 && ageWeeks <= v.due_age_weeks + 4) status = 'Due';
        else if (ageWeeks > v.due_age_weeks + 4) status = 'Overdue';
        return {
            member_id: member._id,
            vaccine_name: v.vaccine_name,
            disease_prevented: v.disease_prevented,
            recommended_age: v.recommended_age,
            due_age_weeks: v.due_age_weeks,
            due_date: member.birth_date ? calcDueDate(member.birth_date, v.due_age_weeks) : null,
            status
        };
    });
}

function buildVaccinesWithDueDates(memberId, birthDate) {
    return VACCINE_SCHEDULE.map(v => ({
        member_id: memberId,
        vaccine_name: v.vaccine_name,
        disease_prevented: v.disease_prevented,
        recommended_age: v.recommended_age,
        due_age_weeks: v.due_age_weeks,
        due_date: calcDueDate(birthDate, v.due_age_weeks),
        status: deriveStatus(birthDate, v.due_age_weeks),
        reminder_sent: false
    }));
}

/* ─────────────────────────── EMAIL MODULE ─────────────────────────── */

let emailTransporter = null;

function getTransporter() {
    if (!emailTransporter) {
        emailTransporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT || '587'),
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });
    }
    return emailTransporter;
}

async function sendReminderEmail({ toEmail, childName, vaccines, isUrgent = false }) {
    if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_email@gmail.com') {
        console.log('⚠️  Email not configured – skipping email for:', toEmail);
        return { skipped: true };
    }

    const fromName = process.env.EMAIL_FROM_NAME || 'AI Health Assistant';
    const subject = isUrgent
        ? `⚠️ URGENT: Child Vaccine Due Tomorrow — ${childName}`
        : `💉 Child Vaccine Reminder — ${childName}`;

    const vaccineRows = vaccines.map(v => {
        const dueStr = v.due_date
            ? new Date(v.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
            : v.recommended_age;
        return `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1a202c;">${v.vaccine_name}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#4a5568;">${v.disease_prevented || '—'}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:${isUrgent ? '#c53030' : '#2b6cb0'};font-weight:600;">${dueStr}</td>
        </tr>`;
    }).join('');

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f7fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#14b8a6,#3b82f6);padding:32px 36px;text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">💉</div>
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Child Vaccine Reminder</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">AI Health Assistant</p>
        </td></tr>
        <tr><td style="padding:32px 36px;">
          <p style="color:#4a5568;font-size:15px;line-height:1.7;margin:0 0 20px;">
            Hello,<br><br>
            This is a ${isUrgent ? '<strong>urgent</strong>' : ''} reminder that <strong>${childName}</strong> is due for the following vaccine${vaccines.length > 1 ? 's' : ''}:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <thead><tr style="background:#f0fdf4;">
              <th style="padding:10px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#718096;">Vaccine</th>
              <th style="padding:10px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#718096;">Prevents</th>
              <th style="padding:10px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#718096;">Due Date</th>
            </tr></thead>
            <tbody>${vaccineRows}</tbody>
          </table>
          <div style="text-align:center;margin:28px 0 20px;">
            <div style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#3b82f6);border-radius:8px;padding:13px 28px;">
              <span style="color:#ffffff;font-size:14px;font-weight:600;">Please consult your healthcare provider promptly</span>
            </div>
          </div>
          <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:14px 18px;margin-top:20px;">
            <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
              ⚠️ <strong>Disclaimer:</strong> This system does not replace medical professionals.
              Always consult a qualified healthcare provider before making any medical decisions.
            </p>
          </div>
        </td></tr>
        <tr><td style="background:#f7fafc;padding:20px 36px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#a0aec0;font-size:12px;">AI Health Assistant — Smart. Safe. Preventive Healthcare.</p>
          <p style="margin:4px 0 0;color:#a0aec0;font-size:11px;">You received this because you registered for vaccine tracking.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    try {
        const info = await getTransporter().sendMail({
            from: `"${fromName}" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject,
            html
        });
        console.log(`✉️  Email sent to ${toEmail}:`, info.messageId);
        return { sent: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌  Email send error:', err.message);
        return { sent: false, error: err.message };
    }
}

/* ─────────────────────────── BACKGROUND CRON JOB ─────────────────────────── */

cron.schedule('0 8 * * *', async () => {
    console.log('⏰  [CRON] Running vaccine reminder check…');
    try {
        const now = new Date();
        const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
        const in1 = new Date(now); in1.setDate(in1.getDate() + 1);

        const pending = await Vaccination.find({
            status: { $in: ['Due', 'pending', 'Overdue'] },
            reminder_sent: false,
            due_date: { $gte: now, $lte: in7 }
        });

        if (pending.length === 0) { console.log('⏰  [CRON] No reminders needed today.'); return; }

        const byMember = {};
        for (const vax of pending) {
            const key = String(vax.member_id);
            if (!byMember[key]) byMember[key] = [];
            byMember[key].push(vax);
        }

        for (const [memberId, vaccines] of Object.entries(byMember)) {
            const member = await FamilyMember.findById(memberId);
            if (!member) continue;
            const user = await User.findById(member.user_id);
            if (!user || !user.email) continue;
            const isUrgent = vaccines.some(v => v.due_date <= in1);
            const result = await sendReminderEmail({ toEmail: user.email, childName: member.name, vaccines, isUrgent });
            if (result.sent) {
                const ids = vaccines.map(v => v._id);
                await Vaccination.updateMany({ _id: { $in: ids } }, { reminder_sent: true });
                console.log(`✉️  [CRON] Sent reminder for ${member.name} (${user.email}) — ${vaccines.length} vaccine(s)`);
            }
        }
    } catch (err) { console.error('❌  [CRON] Error in reminder job:', err.message); }
}, { timezone: 'Asia/Kolkata' });

console.log('⏰  Vaccine reminder cron job scheduled (daily at 08:00 AM IST)');

/* ─────────────────────────── ROUTES: USERS ─────────────────────────── */

app.post('/api/users', async (req, res) => {
    try {
        const { name, email, age, gender, location } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        let user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user) return res.json({ user, created: false });
        user = await User.create({ name, email, age, gender, location });
        const self = await FamilyMember.create({ user_id: user._id, name, age: Number(age) || 0, relationship: 'Self' });
        const vaccines = buildDefaultVaccines(self);
        await Vaccination.insertMany(vaccines);
        res.status(201).json({ user, created: true });
    } catch (err) {
        if (err.code === 11000) {
            const user = await User.findOne({ email: req.body.email });
            return res.json({ user, created: false });
        }
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email.toLowerCase().trim() });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: FAMILY ─────────────────────────── */

app.get('/api/family/:userId', async (req, res) => {
    try {
        const members = await FamilyMember.find({ user_id: req.params.userId });
        res.json(members);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/family', async (req, res) => {
    try {
        const { user_id, name, age, relationship, birth_date } = req.body;
        if (!user_id || !name) return res.status(400).json({ error: 'user_id and name required' });
        const member = await FamilyMember.create({
            user_id, name, age: Number(age) || 0,
            relationship: relationship || 'Other',
            birth_date: birth_date ? new Date(birth_date) : null
        });
        const vaccines = birth_date
            ? buildVaccinesWithDueDates(member._id, new Date(birth_date))
            : buildDefaultVaccines(member);
        await Vaccination.insertMany(vaccines);
        res.status(201).json(member);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/family/:memberId', async (req, res) => {
    try {
        await FamilyMember.findByIdAndDelete(req.params.memberId);
        await Vaccination.deleteMany({ member_id: req.params.memberId });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: VACCINATIONS ─────────────────────────── */

app.get('/api/vaccinations/:memberId', async (req, res) => {
    try {
        const records = await Vaccination.find({ member_id: req.params.memberId });
        res.json(records);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vaccinations', async (req, res) => {
    try {
        const { member_id, vaccine_name, disease_prevented, recommended_age, status, due_age_weeks, due_date } = req.body;
        if (!member_id || !vaccine_name) return res.status(400).json({ error: 'member_id and vaccine_name are required' });
        const existing = await Vaccination.findOne({ member_id, vaccine_name });
        if (existing) return res.json(existing);
        const record = await Vaccination.create({
            member_id, vaccine_name,
            disease_prevented: disease_prevented || '',
            recommended_age: recommended_age || '',
            due_age_weeks: due_age_weeks || null,
            due_date: due_date ? new Date(due_date) : null,
            status: status || 'Due'
        });
        res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vaccinations/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const rec = await Vaccination.findByIdAndUpdate(
            req.params.id,
            { status, last_updated: new Date() },
            { new: true }
        );
        if (!rec) return res.status(404).json({ error: 'Record not found' });
        res.json(rec);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: CHILD REGISTRATION ─────────────────────────── */

app.post('/api/register-child', async (req, res) => {
    try {
        const { user_id, child_name, birth_date, email } = req.body;
        if (!user_id || !child_name || !birth_date)
            return res.status(400).json({ error: 'user_id, child_name, and birth_date are required' });

        const bDate = new Date(birth_date);
        if (isNaN(bDate.getTime()))
            return res.status(400).json({ error: 'Invalid birth_date. Use ISO format e.g. 2025-12-01' });

        const now = new Date();
        const ageYears = (now - bDate) / (365.25 * 24 * 3600 * 1000);

        if (email && user_id) await User.findByIdAndUpdate(user_id, { email: email.toLowerCase().trim() });

        let member = await FamilyMember.findOne({ user_id, birth_date: bDate });
        if (!member) {
            member = await FamilyMember.create({
                user_id, name: child_name,
                age: Math.max(0, ageYears),
                relationship: 'Child', birth_date: bDate
            });
        } else {
            member.name = child_name; await member.save();
            await Vaccination.deleteMany({ member_id: member._id });
        }

        const vaccines = buildVaccinesWithDueDates(member._id, bDate);
        await Vaccination.insertMany(vaccines);

        const upcoming = vaccines
            .filter(v => v.status !== 'Overdue' && v.due_date && v.due_date >= now)
            .sort((a, b) => a.due_date - b.due_date)
            .slice(0, 8);

        res.status(201).json({
            ok: true, member,
            vaccines_seeded: vaccines.length,
            upcoming_vaccines: upcoming,
            disclaimer: 'This system does not replace medical professionals. Always consult a qualified healthcare provider.'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vaccines/:userId', async (req, res) => {
    try {
        const members = await FamilyMember.find({ user_id: req.params.userId });
        if (!members.length) return res.json({ vaccines: [], members: [] });
        const results = [];
        for (const m of members) {
            const vaxList = await Vaccination.find({ member_id: m._id }).sort({ due_date: 1 });
            results.push({ member: { id: m._id, name: m.name, relationship: m.relationship, birth_date: m.birth_date, age: m.age }, vaccines: vaxList });
        }
        res.json({ results, disclaimer: 'This system does not replace medical professionals.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vaccines/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const allowed = ['Completed', 'Due', 'Upcoming', 'Overdue', 'pending'];
        if (status && !allowed.includes(status))
            return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
        const rec = await Vaccination.findByIdAndUpdate(
            req.params.id,
            { status: status || 'Completed', last_updated: new Date() },
            { new: true }
        );
        if (!rec) return res.status(404).json({ error: 'Vaccine record not found' });
        res.json({ ok: true, record: rec });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vaccines/remind', async (req, res) => {
    try {
        const { vaccine_id, user_id } = req.body;
        if (!vaccine_id) return res.status(400).json({ error: 'vaccine_id is required' });
        const vax = await Vaccination.findById(vaccine_id);
        if (!vax) return res.status(404).json({ error: 'Vaccine record not found' });
        const member = await FamilyMember.findById(vax.member_id);
        if (!member) return res.status(404).json({ error: 'Family member not found' });
        const user = user_id ? await User.findById(user_id) : await User.findById(member.user_id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const now = new Date();
        const isUrgent = vax.due_date && (vax.due_date - now) <= 24 * 3600 * 1000;
        const result = await sendReminderEmail({ toEmail: user.email, childName: member.name, vaccines: [vax], isUrgent });
        if (!result.skipped) await Vaccination.findByIdAndUpdate(vaccine_id, { reminder_sent: true });
        res.json({
            ok: true,
            sent: result.sent || false,
            skipped: result.skipped || false,
            message: result.skipped
                ? 'Email not configured. Please set EMAIL_USER and EMAIL_PASSWORD in .env'
                : result.sent ? `Reminder email sent to ${user.email}` : `Email failed: ${result.error}`,
            disclaimer: 'This system does not replace medical professionals.'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vaccine-schedule', (req, res) => {
    res.json({ schedule: VACCINE_SCHEDULE, disclaimer: 'This system does not replace medical professionals.' });
});

/* ─────────────────────────── ROUTES: CHAT HISTORY ─────────────────────────── */

app.get('/api/chat-history/:userId', async (req, res) => {
    try {
        const records = await ChatHistory.find({ user_id: req.params.userId })
            .sort({ timestamp: -1 }).limit(200);
        res.json(records.reverse());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat-history', async (req, res) => {
    try {
        const { user_id, conv_id, user_message, ai_response, response_mode } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        const record = await ChatHistory.create({ user_id, conv_id, user_message, ai_response, response_mode });
        res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─────────────────────────── ROUTES: UPCOMING VACCINES POPUP ─────────────────────────── */

app.get('/api/upcoming-vaccines/:userId', async (req, res) => {
    try {
        const members = await FamilyMember.find({ user_id: req.params.userId });
        if (!members.length) return res.json([]);
        const now = new Date();
        const in3 = new Date(now); in3.setDate(in3.getDate() + 3);
        const result = [];
        for (const m of members) {
            const upcoming = await Vaccination.find({
                member_id: m._id,
                status: { $in: ['Due', 'pending', 'Overdue'] },
                due_date: { $gte: now, $lte: in3 }
            }).sort({ due_date: 1 });
            if (upcoming.length === 0) continue;
            result.push({
                child_name: m.name,
                vaccines: upcoming.map(v => {
                    const diffMs = new Date(v.due_date) - now;
                    const days_left = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
                    return { id: v._id, vaccine_name: v.vaccine_name, due_date: v.due_date ? new Date(v.due_date).toISOString().slice(0, 10) : null, days_left };
                })
            });
        }
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vaccination/:id', async (req, res) => {
    try {
        let { status } = req.body;
        if (typeof status === 'string') status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        const allowed = ['Completed', 'Due', 'Upcoming', 'Overdue', 'Pending'];
        if (status && !allowed.includes(status))
            return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
        const rec = await Vaccination.findByIdAndUpdate(
            req.params.id,
            { status: status || 'Completed', last_updated: new Date() },
            { new: true }
        );
        if (!rec) return res.status(404).json({ error: 'Vaccine record not found' });
        res.json({ ok: true, record: rec });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


/* ─────────────────────────── CONFIG ENDPOINT ─────────────────────────── */

app.get('/config', (req, res) => {
    res.json({
        aiBackendUrl: process.env.AI_BACKEND_URL || 'http://localhost:8000'
    });
});

/* ─────────────────────────── SERVE FRONTEND ─────────────────────────── */

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ─────────────────────────── START ─────────────────────────── */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀  AI Health Assistant server running at http://localhost:${PORT}`);
    console.log(`📊  MongoDB: ${process.env.MONGO_URI ? 'Connected' : 'NOT SET'}`);
    console.log(`✉️   Email: ${process.env.EMAIL_USER || 'NOT CONFIGURED'}`);
    console.log(`🩺  Open http://localhost:${PORT} in your browser\n`);
});

/* ─────────────────────────── CONFIG ENDPOINT ─────────────────────────── */
// Returns AI backend URL so frontend can work both locally and on Railway
