import { useState, useMemo, useEffect } from 'react';
import { ref, onValue, push, set, remove, goOnline } from 'firebase/database';
import { signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import './index.css';


export default function MilkManagementApp() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    // Subscribe to auth state immediately
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    // Also process any pending redirect result (mobile fallback)
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          setUser(result.user);
          setAuthLoading(false);
        }
      })
      .catch(() => {});

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setCustomers([]);
      setEntries([]);
      return;
    }

    const customersRef = ref(db, `users/${user.uid}/customers`);
    const unsubscribeCustomers = onValue(customersRef, (snapshot) => {
      const data = snapshot.val();
      const customersList = data ? Object.values(data) : [];
      setCustomers(customersList);
    });

    const entriesRef = ref(db, `users/${user.uid}/entries`);
    const unsubscribeEntries = onValue(entriesRef, (snapshot) => {
      const data = snapshot.val();
      const entriesList = data ? Object.values(data) : [];
      setEntries(entriesList);
    });

    return () => {
      unsubscribeCustomers();
      unsubscribeEntries();
    };
  }, [user]);

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
    rate: "50",
  });

  const [entryForm, setEntryForm] = useState({
    customer: "",
    morning: "",
    evening: "",
    date: new Date().toISOString().split("T")[0],
  });

  const addCustomer = () => {
    if (!user) return;
    if (!customerForm.name || !customerForm.mobile) {
      alert("Please fill all required fields");
      return;
    }

    const customersRef = ref(db, `users/${user.uid}/customers`);
    const newCustomerRef = push(customersRef);
    const newCustomer = {
      id: newCustomerRef.key,
      ...customerForm,
    };

    set(newCustomerRef, newCustomer);

    setCustomerForm({
      name: "",
      mobile: "",
      rate: "50",
    });
  };

  const addEntry = () => {
    if (!user) return;
    if (!entryForm.customer) {
      alert("Select customer");
      return;
    }

    const morning = parseFloat(entryForm.morning || 0);
    const evening = parseFloat(entryForm.evening || 0);

    const total = morning + evening;

    const entriesRef = ref(db, `users/${user.uid}/entries`);
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
    if (!user) return;
    remove(ref(db, `users/${user.uid}/customers/${id}`));
    entries.forEach((e) => {
      if (e.customerId === id) {
        remove(ref(db, `users/${user.uid}/entries/${e.id}`));
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

  if (authLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loader"></div>
      </div>
    );
  }

  const handleGoogleSignIn = async () => {
    try {
      // Popup is instant — works on desktop and most mobile browsers
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      // Only fall back to redirect if popup was actually blocked
      if (
        err.code === 'auth/popup-blocked' ||
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/cancelled-popup-request'
      ) {
        signInWithRedirect(auth, googleProvider);
      }
    }
  };

  if (!user) {
    return (
      <div className="login-screen">
        {/* Background decorative blobs */}
        <div className="login-blob login-blob-1" />
        <div className="login-blob login-blob-2" />

        {/* Top branding area */}
        <div className="login-top">
          <img src="/logo.png" alt="Logo" className="login-logo" />
          <h1 className="login-title">Milk Manager</h1>
          <p className="login-subtitle">Apna dairy business manage karo<br/>asaani se, kahin bhi 🥛</p>
        </div>

        {/* Bottom sheet card */}
        <div className="login-bottom-sheet animate-fade-in">
          <div className="login-pill" />
          <h2 className="login-card-heading">Welcome Back 👋</h2>
          <p className="login-card-sub">Sign in to access your personal data and sync across all devices.</p>

          <div className="login-features">
            <div className="login-feature-item">☁️ Cloud sync</div>
            <div className="login-feature-item">🔒 Secure data</div>
            <div className="login-feature-item">📱 Any device</div>
          </div>

          <button
            id="google-signin-btn"
            onClick={handleGoogleSignIn}
            className="btn-google-signin"
          >
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div className="glass-card animate-fade-in">
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>📴 You are Offline</h2>
          <p style={{ color: 'var(--text-muted)' }}>This app requires an internet connection to function safely and save your data.</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary" style={{ marginTop: '1.5rem' }}>Try Reconnecting</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="max-w-container">
        {/* Header Section */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src={user.photoURL} alt={user.displayName} style={{ width: '2.5rem', height: '2.5rem', borderRadius: '50%', border: '2px solid var(--primary-color)' }} />
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>{user.displayName}</div>
              <button onClick={() => signOut(auth)} style={{ background: 'none', border: 'none', color: 'var(--danger-color)', fontSize: '0.75rem', padding: 0, cursor: 'pointer', fontWeight: '600' }}>Logout</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {/* Online / Offline Badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.3rem 0.75rem',
              borderRadius: '2rem',
              fontSize: '0.75rem',
              fontWeight: '700',
              background: isOnline ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color: isOnline ? '#10b981' : '#ef4444',
              border: `1px solid ${isOnline ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? '#10b981' : '#ef4444', display: 'inline-block' }} />
              {isOnline ? 'Online' : 'Offline'}
            </div>
            
            <button
              onClick={() => {
                const shareData = {
                  title: 'Milk Management System',
                  text: 'Check out this Milk Management app to manage your dairy business easily!',
                  url: window.location.href,
                };
                if (navigator.share) {
                  navigator.share(shareData);
                } else {
                  window.open(`https://wa.me/?text=${encodeURIComponent(shareData.text + " " + shareData.url)}`, '_blank');
                }
              }}
              className="btn-icon"
              title="Share App"
            >
              🔗
            </button>
            <button
              onClick={toggleTheme}
              className="btn-icon"
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>


        <h1 className="header-title">Milk Manager</h1>

        {/* Main Content Area based on Tabs */}
        <div style={{ paddingBottom: '80px' }}>
          {activeTab === 'dashboard' && (
            <div className="tab-content animate-fade-in">
              {isBillingTime && (
                <div className="billing-alert">
                  <strong>🔔 Billing Time!</strong> Check your monthly bills.
                </div>
              )}
              
              <div className="stats-container">
                <div className="stat-card">
                  <div className="stat-icon" style={{ color: '#3b82f6' }}>👥</div>
                  <div className="stat-details">
                    <h3>Customers</h3>
                    <p className="stat-value">{customers.length}</p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ color: '#10b981' }}>🥛</div>
                  <div className="stat-details">
                    <h3>Today</h3>
                    <p className="stat-value">{todayTotalMilk.toFixed(1)}L</p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ color: '#f59e0b' }}>💰</div>
                  <div className="stat-details">
                    <h3>Revenue</h3>
                    <p className="stat-value">₹{totalExpectedRevenue.toFixed(0)}</p>
                  </div>
                </div>
              </div>

              <div className="glass-card">
                <h2 className="card-title">Add New Customer</h2>
                <div className="form-group">
                  <input type="text" placeholder="Name" value={customerForm.name} onChange={(e) => setCustomerForm({...customerForm, name: e.target.value})} className="form-input" />
                  <input type="text" placeholder="Mobile" value={customerForm.mobile} onChange={(e) => setCustomerForm({...customerForm, mobile: e.target.value})} className="form-input" />
                  <input type="number" placeholder="Rate / Liter" value={customerForm.rate} onChange={(e) => setCustomerForm({...customerForm, rate: e.target.value})} className="form-input" />
                  <button onClick={addCustomer} className="btn btn-primary">Add Customer</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'customers' && (
            <div className="tab-content animate-fade-in">
              <div className="glass-card">
                <h2 className="card-title">Daily Entry</h2>
                <div className="form-group">
                  <select
                    value={entryForm.customer}
                    onChange={(e) => setEntryForm({...entryForm, customer: e.target.value})}
                    className="form-input"
                  >
                    <option value="">Select Customer</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <input type="number" placeholder="Morning (L)" value={entryForm.morning} onChange={(e) => setEntryForm({...entryForm, morning: e.target.value})} className="form-input" />
                    <input type="number" placeholder="Evening (L)" value={entryForm.evening} onChange={(e) => setEntryForm({...entryForm, evening: e.target.value})} className="form-input" />
                  </div>
                  <input type="date" value={entryForm.date} onChange={(e) => setEntryForm({...entryForm, date: e.target.value})} className="form-input" />
                  <button onClick={addEntry} className="btn btn-success">Save Entry</button>
                </div>
              </div>

              <div className="glass-card">
                <div className="card-header-flex">
                  <h2 className="card-title">Customer List</h2>
                  <input type="text" placeholder="Search..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className="search-input" />
                </div>
                
                <div className="list-container">
                  {filteredCustomers.map((c) => (
                    <div key={c.id} className="item-card">
                      <div className="item-info">
                        <div className="item-name">{c.name}</div>
                        <div className="item-sub">{c.mobile} • ₹{c.rate}/L</div>
                      </div>
                      <button onClick={() => deleteCustomer(c.id)} className="btn-delete">🗑️</button>
                    </div>
                  ))}
                  {filteredCustomers.length === 0 && <div className="empty-state">No customers found</div>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'entries' && (
            <div className="tab-content animate-fade-in">
              <div className="glass-card">
                <div className="card-header-flex">
                  <h2 className="card-title">Milk Records</h2>
                  <input type="date" value={entryDateFilter} onChange={(e) => setEntryDateFilter(e.target.value)} className="search-input" />
                </div>
                
                <div className="list-container">
                  {filteredEntries.map((e) => {
                    const c = customers.find(cu => cu.id === e.customerId);
                    return (
                      <div key={e.id} className="item-card">
                        <div className="item-info">
                          <div className="item-name">{c?.name || 'Unknown'}</div>
                          <div className="item-sub">{e.date}</div>
                          <div className="item-details">
                            <span>M: {e.morning}L</span>
                            <span>E: {e.evening}L</span>
                            <span className="bold">Total: {e.total}L</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredEntries.length === 0 && <div className="empty-state">No records for this date</div>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="tab-content animate-fade-in">
              <div className="glass-card">
                <h2 className="card-title">Monthly Billing</h2>
                <div className="list-container">
                  {bills.map((b) => {
                    const message = `નમસ્તે ${b.customer.name}, કુલ દૂધ: ${b.totalMilk.toFixed(2)} લિટર (@₹${b.customer.rate}). કુલ બિલ: ₹${b.amount.toFixed(2)}.`;
                    const mobileFormatted = b.customer.mobile.length === 10 ? `91${b.customer.mobile}` : b.customer.mobile;
                    const whatsappLink = `https://wa.me/${mobileFormatted}?text=${encodeURIComponent(message)}`;
                    
                    return (
                      <div key={b.customer.id} className="item-card">
                        <div className="item-info">
                          <div className="item-name">{b.customer.name}</div>
                          <div className="item-sub">{b.totalMilk.toFixed(1)}L • ₹{b.customer.rate}/L</div>
                          <div className="item-amount">₹{b.amount.toFixed(2)}</div>
                        </div>
                        <div className="item-actions">
                          <a href={whatsappLink} target="_blank" rel="noreferrer" className="btn-action whatsapp">WA</a>
                          <a href={`sms:${b.customer.mobile}?body=${encodeURIComponent(message)}`} className="btn-action sms">SMS</a>
                        </div>
                      </div>
                    );
                  })}
                  {bills.length === 0 && <div className="empty-state">No billing data</div>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation for Mobile */}
        <nav className="bottom-nav">
          <button className={activeTab === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('dashboard')}>
            <span className="nav-icon">🏠</span>
            <span className="nav-text">Home</span>
          </button>
          <button className={activeTab === 'customers' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('customers')}>
            <span className="nav-icon">📝</span>
            <span className="nav-text">Entry</span>
          </button>
          <button className={activeTab === 'entries' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('entries')}>
            <span className="nav-icon">📅</span>
            <span className="nav-text">Records</span>
          </button>
          <button className={activeTab === 'billing' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('billing')}>
            <span className="nav-icon">💰</span>
            <span className="nav-text">Billing</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
