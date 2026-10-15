/**
 * SmartTrip IndexedDB Storage Layer
 * Manages persistent storage for 'trips', 'feedback', 'users', and 'session'.
 * Supports Blobs natively without the 5MB localStorage limit.
 */

const DB_NAME = 'SmartTripDB';
const DB_VERSION = 2;

class SmartTripDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Store for trips: indexed by unique trip ID
        if (!db.objectStoreNames.contains('trips')) {
          const tripStore = db.createObjectStore('trips', { keyPath: 'id' });
          tripStore.createIndex('datetime', 'datetime', { unique: false });
          tripStore.createIndex('mode', 'mode', { unique: false });
          tripStore.createIndex('userId', 'userId', { unique: false });
        } else {
          const tripStore = event.target.transaction.objectStore('trips');
          if (!tripStore.indexNames.contains('userId')) {
            tripStore.createIndex('userId', 'userId', { unique: false });
          }
        }

        // Store for user feedback
        if (!db.objectStoreNames.contains('feedback')) {
          db.createObjectStore('feedback', { keyPath: 'id', autoIncrement: true });
        }

        // Store for user accounts
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'email' });
          userStore.createIndex('id', 'id', { unique: true });
          userStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Store for active session
        if (!db.objectStoreNames.contains('session')) {
          db.createObjectStore('session', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async getStore(storeName, mode = 'readonly') {
    const db = await this.open();
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  async put(storeName, item) {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, key) {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(storeName) {
    const store = await this.getStore(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, key) {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // ----------------------------------------------------
  // Trips Methods
  // ----------------------------------------------------
  async saveTrip(trip) {
    return this.put('trips', trip);
  }

  async getTrip(id) {
    return this.get('trips', id);
  }

  async getAllTrips(userEmail = null) {
    const trips = await this.getAll('trips');
    let filtered = trips;
    if (userEmail) {
      filtered = trips.filter(t => !t.userId || t.userId === userEmail);
    }
    // Sort descending by datetime or creation
    return filtered.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));
  }

  async deleteTrip(id) {
    return this.delete('trips', id);
  }

  // ----------------------------------------------------
  // Feedback Methods
  // ----------------------------------------------------
  async saveFeedback(feedback) {
    return this.put('feedback', feedback);
  }

  async getAllFeedback() {
    return this.getAll('feedback');
  }

  // ----------------------------------------------------
  // User Authentication & Account Methods
  // ----------------------------------------------------
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + '_smarttrip_salt_2026');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async registerUser({ name, email, password, avatar = '👤', bio = '' }) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.get('users', normalizedEmail);
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const passwordHash = await this.hashPassword(password);
    const user = {
      id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: passwordHash,
      avatar: avatar || '👤',
      bio: bio.trim(),
      createdAt: new Date().toISOString()
    };

    await this.put('users', user);
    await this.setCurrentSession(user);
    return user;
  }

  async authenticateUser(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.get('users', normalizedEmail);
    if (!user) {
      throw new Error('No account found with this email.');
    }

    const passwordHash = await this.hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      throw new Error('Incorrect password. Please try again.');
    }

    await this.setCurrentSession(user);
    return user;
  }

  async setCurrentSession(user) {
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || '👤',
      bio: user.bio || '',
      createdAt: user.createdAt
    };
    await this.put('session', { key: 'currentUser', user: safeUser, loggedInAt: new Date().toISOString() });
    return safeUser;
  }

  async getCurrentSession() {
    const sessionRecord = await this.get('session', 'currentUser');
    if (!sessionRecord || !sessionRecord.user) return null;
    return sessionRecord.user;
  }

  async clearCurrentSession() {
    return this.delete('session', 'currentUser');
  }

  async updateUserProfile(email, updates) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.get('users', normalizedEmail);
    if (!user) throw new Error('User not found.');

    const updatedUser = { ...user, ...updates };
    await this.put('users', updatedUser);

    // Update active session
    await this.setCurrentSession(updatedUser);
    return updatedUser;
  }
}

// Global singleton instance
window.smartTripDB = new SmartTripDB();
