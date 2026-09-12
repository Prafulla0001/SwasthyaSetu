// config/firebase.js
const fs   = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                 = require('firebase-admin/firestore');
const { getAuth }                      = require('firebase-admin/auth');

let db;
let adminAuth;
let isMock = false;

// 1. Check for serviceAccountKey.json file in project root or config dir
const serviceAccountPathRoot = path.join(__dirname, '..', 'serviceAccountKey.json');
const serviceAccountPathConf = path.join(__dirname, 'serviceAccountKey.json');

let serviceAccountFile = null;
if (fs.existsSync(serviceAccountPathRoot)) {
  serviceAccountFile = serviceAccountPathRoot;
} else if (fs.existsSync(serviceAccountPathConf)) {
  serviceAccountFile = serviceAccountPathConf;
}

// 2. Check env variables
const hasEnvCreds =
  process.env.FIREBASE_PROJECT_ID &&
  !process.env.FIREBASE_PROJECT_ID.includes('your-') &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  !process.env.FIREBASE_CLIENT_EMAIL.includes('your-') &&
  process.env.FIREBASE_PRIVATE_KEY &&
  !process.env.FIREBASE_PRIVATE_KEY.includes('YOUR_PRIVATE_KEY_HERE') &&
  process.env.FIREBASE_PRIVATE_KEY.length > 200;

try {
  if (!getApps().length) {
    if (serviceAccountFile) {
      console.log(`🔑 Loading Firebase credentials from: ${serviceAccountFile}`);
      const serviceAccount = require(serviceAccountFile);
      initializeApp({ credential: cert(serviceAccount) });
    } else if (hasEnvCreds) {
      console.log('🔑 Initializing Firebase Admin with .env credentials');
      initializeApp({
        credential: cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        })
      });
    } else {
      throw new Error('No valid Firebase credentials found');
    }
  }

  db = getFirestore();
  adminAuth = getAuth;
  console.log('✅ Firebase Admin connected successfully');

} catch (err) {
  isMock = true;
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║ ⚠️  FIREBASE CREDENTIALS NOT CONFIGURED                                  ║');
  console.log('║ Running with safe in-memory fallback store so server starts up cleanly!  ║');
  console.log('║ To connect live Firebase:                                                ║');
  console.log('║ 1. Place your serviceAccountKey.json into SwasthyaSetu folder            ║');
  console.log('║    OR fill FIREBASE_PROJECT_ID & FIREBASE_PRIVATE_KEY in .env            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // In-memory mock store for collections
  const memoryStore = {};

  const createQuery = (colName, filters = [], order = null) => {
    return {
      where(field, op, val) {
        return createQuery(colName, [...filters, { field, op, val }], order);
      },
      orderBy(field, dir = 'asc') {
        return createQuery(colName, filters, { field, dir });
      },
      async get() {
        let items = Object.values(memoryStore[colName] || {});
        for (const f of filters) {
          if (f.op === '==') items = items.filter(i => i[f.field] === f.val);
        }
        if (order) {
          items.sort((a, b) => {
            const va = a[order.field] || '';
            const vb = b[order.field] || '';
            return order.dir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
          });
        }
        return {
          empty: items.length === 0,
          docs: items.map(data => ({
            id: data._id || data.id,
            data: () => data,
            exists: true
          }))
        };
      }
    };
  };

  db = {
    collection(colName) {
      if (!memoryStore[colName]) memoryStore[colName] = {};
      const q = createQuery(colName);
      return {
        ...q,
        async add(data) {
          const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          const record = { ...data, id, _id: id, createdAt: data.createdAt || new Date().toISOString() };
          memoryStore[colName][id] = record;
          return { id, get: async () => ({ exists: true, data: () => record }) };
        },
        doc(id) {
          return {
            async get() {
              const item = memoryStore[colName][id];
              return { exists: !!item, data: () => item || null, id };
            },
            async set(data, opts = {}) {
              const prev = memoryStore[colName][id] || {};
              memoryStore[colName][id] = opts.merge ? { ...prev, ...data, id } : { ...data, id };
              return { writeTime: new Date() };
            },
            async update(data) {
              const prev = memoryStore[colName][id] || {};
              memoryStore[colName][id] = { ...prev, ...data };
              return { writeTime: new Date() };
            },
            async delete() {
              delete memoryStore[colName][id];
              return { writeTime: new Date() };
            }
          };
        }
      };
    }
  };

  adminAuth = () => ({
    verifyIdToken: async (token) => {
      return {
        uid: 'demo_user_123',
        email: 'demo@swasthyasetu.org',
        name: 'Demo Patient'
      };
    },
    updateUser: async () => {}
  });
}

const admin = { auth: adminAuth };

module.exports = { db, admin, isMock };
