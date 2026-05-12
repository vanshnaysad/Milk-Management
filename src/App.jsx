import { useState, useMemo, useEffect, useCallback } from 'react';
import { ref, onValue, push, set, remove, goOnline } from 'firebase/database';
import { db } from './firebase';
import './index.css';


export default function MilkManagementApp() {
  const [customers, setCustomers] = useState([]);
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    const customersRef = ref(db, 'customers');
    const unsubscribeCustomers = onValue(customersRef, (snapshot) => {
      const data = snapshot.val();
      const customersList = data ? Object.values(data) : [];
      setCustomers(customersList);
    });

    const entriesRef = ref(db, 'entries');
    const unsubscribeEntries = onValue(entriesRef, (snapshot) => {
      const data = snapshot.val();
      const entriesList = data ? Object.values(data) : [];
      setEntries(entriesList);
    });

    return () => {
      unsubscribeCustomers();
      unsubscribeEntries();
    };
  }, []);

  // ── ONLINE / OFFLINE STATUS ──────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      goOnline(db);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── LOCAL DEVICE MIRROR (always keep a copy on the phone/device) ─────────
  useEffect(() => {
    if (customers.length > 0 || entries.length > 0) {
      const snapshot = { customers, entries, savedAt: new Date().toISOString() };
      localStorage.setItem('milk_data_mirror', JSON.stringify(snapshot));
    }
  }, [customers, entries]);

  // Load from local mirror if Firebase is offline
  useEffect(() => {
    const mirror = localStorage.getItem('milk_data_mirror');
    if (!navigator.onLine && mirror) {
      try {
        const { customers: c, entries: e } = JSON.parse(mirror);
        setCustomers(c || []);
        setEntries(e || []);
      } catch (_) {}
    }
  }, []);

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('milk_theme') || 'light';
  });

  useEffect(() => {
    localStorage.setItem('milk_theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  // ── BACKUP / EXPORT FUNCTIONS ────────────────────────────────────────────
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState('');

  const getBackupData = useCallback(() => {
    return {
      appName: 'Milk Management System',
      exportedAt: new Date().toLocaleString('en-IN'),
      customers,
      entries,
      summary: {
        totalCustomers: customers.length,
        totalEntries: entries.length,
      }
    };
  }, [customers, entries]);

  // Download JSON file to device
  const downloadJSON = useCallback(() => {
    const data = getBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `milk-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupSuccess('JSON downloaded to your device! ✅');
    setTimeout(() => setBackupSuccess(''), 3000);
  }, [getBackupData]);

  // Download CSV file
  const downloadCSV = useCallback(() => {
    const rows = [['Customer Name', 'Mobile', 'Rate', 'Date', 'Morning (L)', 'Evening (L)', 'Total (L)', 'Amount (₹)']];
    entries.forEach(e => {
      const c = customers.find(cu => cu.id === e.customerId);
      if (c) {
        rows.push([
          c.name, c.mobile, c.rate,
          e.date, e.morning, e.evening, e.total,
          (e.total * Number(c.rate)).toFixed(2)
        ]);
      }
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `milk-entries-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupSuccess('CSV downloaded to your device! ✅');
    setTimeout(() => setBackupSuccess(''), 3000);
  }, [customers, entries]);

  // Send backup via Gmail compose
  const sendGmailBackup = useCallback(() => {
    const data = getBackupData();
    const subject = encodeURIComponent(`Milk Management Backup – ${new Date().toLocaleDateString('en-IN')}`);
    const customerList = customers.map(c => `• ${c.name} (${c.mobile}) @ ₹${c.rate}/L`).join('\n');
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = entries
      .filter(e => e.date === today)
      .map(e => {
        const c = customers.find(cu => cu.id === e.customerId);
        return `• ${c?.name}: ${e.morning}L (morn) + ${e.evening}L (eve) = ${e.total}L`;
      }).join('\n') || 'No entries today.';
    const totalRevenue = customers.reduce((sum, c) => {
      const cEntries = entries.filter(e => e.customerId === c.id);
      return sum + cEntries.reduce((s, e) => s + e.total, 0) * Number(c.rate);
    }, 0);

    const body = encodeURIComponent(
`🥛 MILK MANAGEMENT BACKUP
Date: ${new Date().toLocaleString('en-IN')}

📊 SUMMARY
Total Customers: ${customers.length}
Total Entries: ${entries.length}
Estimated Revenue: ₹${totalRevenue.toFixed(2)}

👥 CUSTOMERS
${customerList}

📅 TODAY'S ENTRIES (${today})
${todayEntries}

📦 FULL JSON BACKUP
${JSON.stringify(data, null, 2)}

—
Sent from Milk Management System`
    );
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank');
    setBackupSuccess('Gmail opened with backup data! ✅');
    setTimeout(() => setBackupSuccess(''), 4000);
  }, [customers, entries, getBackupData]);

  // Restore from JSON file
  const restoreFromFile = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.customers && Array.isArray(data.customers)) {
          // Write customers to Firebase
          data.customers.forEach(c => {
            if (c.id) set(ref(db, `customers/${c.id}`), c);
          });
        }
        if (data.entries && Array.isArray(data.entries)) {
          data.entries.forEach(en => {
            if (en.id) set(ref(db, `entries/${en.id}`), en);
          });
        }
        setBackupSuccess('Data restored successfully from file! ✅');
        setTimeout(() => setBackupSuccess(''), 4000);
      } catch (_) {
        setBackupSuccess('❌ Invalid backup file. Please use a valid JSON backup.');
        setTimeout(() => setBackupSuccess(''), 4000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // Check if it's billing time (last day of month, or 1st/2nd of new month)
  const isBillingTime = useMemo(() => {
    const today = new Date();
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const currentDay = today.getDate();
    return currentDay === lastDayOfMonth || currentDay === 1 || currentDay === 2;
  }, []);

  const [customerSearch, setCustomerSearch] = useState("");
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.mobile.includes(customerSearch));
  }, [customers, customerSearch]);

  const [entryDateFilter, setEntryDateFilter] = useState("");
  const filteredEntries = useMemo(() => {
    if (!entryDateFilter) return entries;
    return entries.filter(e => e.date === entryDateFilter);
  }, [entries, entryDateFilter]);

  const todayStr = new Date().toISOString().split("T")[0];
  const todayTotalMilk = useMemo(() => {
    return entries
      .filter(e => e.date === todayStr)
      .reduce((sum, e) => sum + e.total, 0);
  }, [entries, todayStr]);

  const [customerForm, setCustomerForm] = useState({
    name: "",
    mobile: "",
    rate: "60",
  });

  const [entryForm, setEntryForm] = useState({
    customer: "",
    morning: "",
    evening: "",
    date: new Date().toISOString().split("T")[0],
  });

  const addCustomer = () => {
    if (!customerForm.name || !customerForm.mobile) {
      alert("Please fill all required fields");
      return;
    }

    const customersRef = ref(db, 'customers');
    const newCustomerRef = push(customersRef);
    const newCustomer = {
      id: newCustomerRef.key,
      ...customerForm,
    };

    set(newCustomerRef, newCustomer);

    setCustomerForm({
      name: "",
      mobile: "",
      rate: "60",
    });
  };

  const addEntry = () => {
    if (!entryForm.customer) {
      alert("Select customer");
      return;
    }

    const morning = parseFloat(entryForm.morning || 0);
    const evening = parseFloat(entryForm.evening || 0);

    const total = morning + evening;

    const entriesRef = ref(db, 'entries');
    const newEntryRef = push(entriesRef);

    const newEntry = {
      id: newEntryRef.key,
      customerId: entryForm.customer,
      morning,
      evening,
      total,
      date: entryForm.date,
    };

    set(newEntryRef, newEntry);

    setEntryForm({
      customer: "",
      morning: "",
      evening: "",
      date: new Date().toISOString().split("T")[0],
    });
  };

  const deleteCustomer = (id) => {
    remove(ref(db, `customers/${id}`));
    entries.forEach((e) => {
      if (e.customerId === id) {
        remove(ref(db, `entries/${e.id}`));
      }
    });
  };

  const bills = useMemo(() => {
    return customers.map((customer) => {
      const customerEntries = entries.filter(
        (e) => e.customerId === customer.id
      );

      const totalMilk = customerEntries.reduce(
        (sum, e) => sum + e.total,
        0
      );

      const amount = totalMilk * Number(customer.rate);

      return {
        customer,
        totalMilk,
        amount,
      };
    });
  }, [customers, entries]);

  const totalExpectedRevenue = useMemo(() => {
    return bills.reduce((sum, b) => sum + b.amount, 0);
  }, [bills]);

  return (
    <div className="app-container">
      <div className="max-w-container">
        {/* Top Bar: Online status + Theme toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          {/* Online / Offline Badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.35rem 0.9rem',
            borderRadius: '2rem',
            fontSize: '0.8rem',
            fontWeight: '700',
            background: isOnline ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            color: isOnline ? '#10b981' : '#ef4444',
            border: `1.5px solid ${isOnline ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOnline ? '#10b981' : '#ef4444', display: 'inline-block', boxShadow: isOnline ? '0 0 6px #10b981' : '0 0 6px #ef4444', animation: 'pulse-dot 1.5s infinite' }} />
            {isOnline ? '🟢 Online – Firebase Synced' : '🔴 Offline – Using Device Cache'}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {/* Backup Button */}
            <button
              onClick={() => setBackupOpen(v => !v)}
              className="btn"
              style={{ width: 'auto', padding: '0.5rem 1rem', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', boxShadow: '0 2px 12px rgba(99,102,241,0.4)', border: 'none' }}
            >
              💾 Backup & Restore
            </button>
            <button
              onClick={toggleTheme}
              className="btn"
              style={{
                width: 'auto',
                padding: '0.5rem 1rem',
                backgroundColor: theme === 'light' ? '#1e293b' : '#f8fafc',
                color: theme === 'light' ? '#f8fafc' : '#1e293b',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
              }}
            >
              {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
            </button>
          </div>
        </div>

        {/* ── BACKUP PANEL ────────────────────────────────────────── */}
        {backupOpen && (
          <div className="glass-card animate-fade-in" style={{
            marginBottom: '1.5rem',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))',
            borderColor: 'rgba(99,102,241,0.35)',
            borderLeft: '4px solid #6366f1'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 className="card-title" style={{ marginBottom: 0, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>💾 Backup & Restore Data</h2>
              <button onClick={() => setBackupOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              Your data is automatically saved on <strong>Firebase Cloud</strong> (syncs across all devices) AND mirrored on <strong>this device</strong> (works offline). Use these options for extra safety:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {/* Gmail Backup */}
              <button
                onClick={sendGmailBackup}
                style={{
                  padding: '0.85rem 1rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #ea4335, #fbbc04)',
                  color: '#fff', fontWeight: '700', fontSize: '0.9rem',
                  boxShadow: '0 4px 15px rgba(234,67,53,0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                }}
                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(234,67,53,0.4)'; }}
                onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 15px rgba(234,67,53,0.3)'; }}
              >
                📧 Send Backup to Gmail
              </button>

              {/* Download JSON */}
              <button
                onClick={downloadJSON}
                style={{
                  padding: '0.85rem 1rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                  color: '#fff', fontWeight: '700', fontSize: '0.9rem',
                  boxShadow: '0 4px 15px rgba(59,130,246,0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                }}
                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59,130,246,0.4)'; }}
                onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 15px rgba(59,130,246,0.3)'; }}
              >
                📥 Download JSON Backup
              </button>

              {/* Download CSV */}
              <button
                onClick={downloadCSV}
                style={{
                  padding: '0.85rem 1rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff', fontWeight: '700', fontSize: '0.9rem',
                  boxShadow: '0 4px 15px rgba(16,185,129,0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                }}
                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(16,185,129,0.4)'; }}
                onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 15px rgba(16,185,129,0.3)'; }}
              >
                📊 Download CSV (Excel)
              </button>

              {/* Restore from file */}
              <label
                style={{
                  padding: '0.85rem 1rem', borderRadius: '0.75rem',
                  background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                  color: '#fff', fontWeight: '700', fontSize: '0.9rem',
                  boxShadow: '0 4px 15px rgba(245,158,11,0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                }}
                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseOut={e => { e.currentTarget.style.transform = ''; }}
              >
                🔄 Restore from JSON File
                <input type="file" accept=".json" onChange={restoreFromFile} style={{ display: 'none' }} />
              </label>
            </div>

            {/* Success message */}
            {backupSuccess && (
              <div style={{
                padding: '0.75rem 1rem', borderRadius: '0.5rem',
                background: 'rgba(16,185,129,0.15)', color: '#10b981',
                border: '1px solid rgba(16,185,129,0.3)', fontWeight: '600', fontSize: '0.9rem',
                animation: 'fadeIn 0.3s ease'
              }}>
                {backupSuccess}
              </div>
            )}

            {/* Info box */}
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
                <strong>🛡️ Your Data is Protected in 3 Ways:</strong><br />
                1️⃣ <strong>Firebase Cloud</strong> – Syncs automatically across all devices<br />
                2️⃣ <strong>Device Cache</strong> – Works offline, auto-saved on your phone<br />
                3️⃣ <strong>Manual Backup</strong> – Email to Gmail or download file for extra safety
              </p>
            </div>
          </div>
        )}

        <h1 className="header-title animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <img src="/logo.png" alt="Logo" style={{ height: '3.5rem', width: '3.5rem', objectFit: 'contain', borderRadius: '0.5rem' }} />
          Milk Management System
        </h1>

        {isBillingTime && (
          <div className="glass-card animate-fade-in" style={{ 
            backgroundColor: 'rgba(254, 243, 199, 0.8)', 
            borderColor: 'rgba(245, 158, 11, 0.4)', 
            color: '#b45309', 
            borderLeft: '4px solid #f59e0b' 
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.25rem' }}>
              🔔 Time to Send Bills!
            </h3>
            <p style={{ margin: 0, fontWeight: '500' }}>
              It's the end of the month. Scroll down to the Monthly Billing section to send SMS/WhatsApp reminders to your customers.
            </p>
          </div>
        )}

        {/* Stats Dashboard */}
        <div className="stats-container animate-fade-in">
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>👥</div>
            <div className="stat-details">
              <h3>Total Customers</h3>
              <p className="stat-value">{customers.length}</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>🥛</div>
            <div className="stat-details">
              <h3>Today's Milk</h3>
              <p className="stat-value">{todayTotalMilk.toFixed(1)} L</p>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>💰</div>
            <div className="stat-details">
              <h3>Est. Revenue</h3>
              <p className="stat-value">₹{totalExpectedRevenue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="grid-layout">
          <div className="glass-card animate-fade-in delay-1">
            <h2 className="card-title">Add Customer</h2>

            <div className="form-group">
              <input
                type="text"
                placeholder="Customer Name"
                value={customerForm.name}
                onChange={(e) =>
                  setCustomerForm({
                    ...customerForm,
                    name: e.target.value,
                  })
                }
                className="form-input"
              />

              <input
                type="text"
                placeholder="Mobile Number"
                value={customerForm.mobile}
                onChange={(e) =>
                  setCustomerForm({
                    ...customerForm,
                    mobile: e.target.value,
                  })
                }
                className="form-input"
              />

              <input
                type="number"
                placeholder="Milk Rate Per Liter"
                value={customerForm.rate}
                onChange={(e) =>
                  setCustomerForm({
                    ...customerForm,
                    rate: e.target.value,
                  })
                }
                className="form-input"
              />

              <button
                onClick={addCustomer}
                className="btn btn-primary"
              >
                Add Customer
              </button>
            </div>
          </div>

          <div className="glass-card animate-fade-in delay-1">
            <h2 className="card-title">Daily Milk Entry</h2>

            <div className="form-group">
              <select
                value={entryForm.customer}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    customer: e.target.value,
                  })
                }
                className="form-input"
              >
                <option value="">Select Customer</option>

                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                placeholder="Morning Milk (L)"
                value={entryForm.morning}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    morning: e.target.value,
                  })
                }
                className="form-input"
              />

              <input
                type="number"
                placeholder="Evening Milk (L)"
                value={entryForm.evening}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    evening: e.target.value,
                  })
                }
                className="form-input"
              />

              <input
                type="date"
                value={entryForm.date}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    date: e.target.value,
                  })
                }
                className="form-input"
              />

              <button
                onClick={addEntry}
                className="btn btn-success"
              >
                Save Entry
              </button>
            </div>
          </div>
        </div>

        <div className="glass-card animate-fade-in delay-2">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Customers</h2>
            <input 
              type="text" 
              placeholder="🔍 Search customers..." 
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="form-input"
              style={{ width: 'auto', minWidth: '250px', padding: '0.5rem 1rem', borderRadius: '2rem' }}
            />
          </div>

          <table className="table-container">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th>Rate</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>{customer.mobile}</td>
                  <td>₹{customer.rate}</td>
                  <td>
                    <button
                      onClick={() => deleteCustomer(customer.id)}
                      className="btn btn-danger"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    {customers.length === 0 ? "No customers added yet." : "No customers found matching search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="glass-card animate-fade-in delay-2">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Milk Entry Records</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: '600' }}>Date Filter:</label>
              <input 
                type="date" 
                value={entryDateFilter}
                onChange={(e) => setEntryDateFilter(e.target.value)}
                className="form-input"
                style={{ width: 'auto', padding: '0.5rem 1rem', borderRadius: '0.5rem' }}
              />
              {entryDateFilter && (
                <button onClick={() => setEntryDateFilter("")} className="btn" style={{ width: 'auto', padding: '0.5rem', background: 'transparent', color: 'var(--danger-color)', border: '1px solid var(--danger-color)' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <table className="table-container">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Morning</th>
                <th>Evening</th>
                <th>Total</th>
                <th>Date</th>
              </tr>
            </thead>

            <tbody>
              {filteredEntries.map((entry) => {
                const customer = customers.find(
                  (c) => c.id === entry.customerId
                );

                return (
                  <tr key={entry.id}>
                    <td>{customer?.name}</td>
                    <td>{entry.morning} L</td>
                    <td>{entry.evening} L</td>
                    <td className="font-semibold">{entry.total} L</td>
                    <td>{entry.date}</td>
                  </tr>
                );
              })}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    {entries.length === 0 ? "No entries recorded yet." : "No entries found for selected date."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="glass-card animate-fade-in delay-3">
          <h2 className="card-title">Monthly Billing</h2>

          <table className="table-container">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Total Milk</th>
                <th>Rate</th>
                <th>Total Amount</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {bills.map((bill) => {
                const message = `નમસ્તે ${bill.customer.name}, આ મહિનાનું આપનું કુલ દૂધ ${bill.totalMilk.toFixed(2)} લિટર થયું છે (ભાવ: ₹${bill.customer.rate}/લિટર). આપનું કુલ બિલ ₹${bill.amount.toFixed(2)} છે. કૃપા કરીને બિલ ચૂકવી આપવા વિનંતી.`;
                const smsLink = `sms:${bill.customer.mobile}?body=${encodeURIComponent(message)}`;
                // Assuming Indian mobile numbers for WhatsApp wa.me link (+91), fallback to raw if already has country code.
                // Simple logic: if length is 10, prepend 91
                const mobileFormatted = bill.customer.mobile.length === 10 ? `91${bill.customer.mobile}` : bill.customer.mobile;
                const whatsappLink = `https://wa.me/${mobileFormatted}?text=${encodeURIComponent(message)}`;

                return (
                  <tr key={bill.customer.id}>
                    <td>{bill.customer.name}</td>
                    <td>{bill.totalMilk.toFixed(2)} L</td>
                    <td>₹{bill.customer.rate}</td>
                    <td className="font-semibold text-green">
                      ₹{bill.amount.toFixed(2)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <a href={smsLink} className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', textDecoration: 'none', textAlign: 'center', fontSize: '0.875rem', borderRadius: '0.5rem' }}>SMS</a>
                        <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="btn btn-success" style={{ padding: '0.4rem 0.8rem', textDecoration: 'none', textAlign: 'center', fontSize: '0.875rem', borderRadius: '0.5rem' }}>WhatsApp</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {bills.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No billing data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
