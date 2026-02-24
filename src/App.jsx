import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://ntxtprezgvykapxpxflm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50eHRwcmV6Z3Z5a2FweHB4ZmxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4OTQ5MDUsImV4cCI6MjA4NzQ3MDkwNX0.zRUB300wMkeFEBRKneLR1GcRN3U-DSVejD5g_W-6GLU";

// Auth helpers
async function sbAuth(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.msg || "Auth error");
  return json;
}

// For squad/leaderboard tables — always uses anon key (no RLS)
async function sbFetch(path, options = {}, token = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// For user_data table — uses auth token (has RLS)
async function sbFetchAuth(path, options = {}) {
  const token = localStorage.getItem("grind_token") || SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const POINTS = { green: 15, yellow: 5, red: -10 };

// Level thresholds — each level requires more pts than the last
function getLevelInfo(pts) {
  const safePts = Math.max(0, pts);
  let level = 1;
  let threshold = 100;
  let accumulated = 0;
  while (safePts >= accumulated + threshold) {
    accumulated += threshold;
    level++;
    threshold += 75;
  }
  const progress = safePts - accumulated;
  const needed = threshold;
  return { level, progress, needed, totalPts: safePts };
}

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getMonthMeta(year, month) {
  return {
    firstDay: new Date(year, month, 1).getDay(),
    daysInMonth: new Date(year, month + 1, 0).getDate(),
  };
}

const ACHIEVEMENTS = [
  { id: "first_day", icon: "🔥", name: "Day One", desc: "Log your first day", check: (d) => Object.keys(d).length >= 1 },
  { id: "week_streak", icon: "⚡", name: "Electric Week", desc: "7 green days in a row", check: (d) => calcStreak(d) >= 7 },
  { id: "month_streak", icon: "🏆", name: "Unstoppable", desc: "30 green days in a row", check: (d) => calcStreak(d) >= 30 },
  { id: "no_reds", icon: "🛡️", name: "No Excuses", desc: "7 days with no red", check: (d) => hasWeekNoRed(d) },
  { id: "grind_month", icon: "👑", name: "Grind Month", desc: "80%+ green days in a month", check: (d) => hasGrindMonth(d) },
  { id: "comeback", icon: "🦅", name: "Comeback", desc: "Green after 3+ red days", check: (d) => hasComeback(d) },
  { id: "fifty_days", icon: "🎯", name: "Fifty Days", desc: "Log 50 total days", check: (d) => Object.keys(d).length >= 50 },
  { id: "hundred_days", icon: "💯", name: "Century", desc: "Log 100 total days", check: (d) => Object.keys(d).length >= 100 },
];

function calcStreak(data) {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (getEntryColor(data[key]) === "green") streak++;
    else break;
  }
  return streak;
}

function hasWeekNoRed(data) {
  const sorted = Object.entries(data).sort(([a],[b]) => a.localeCompare(b));
  let cons = 0;
  for (const [,v] of sorted) {
    if (getEntryColor(v) !== "red") { cons++; if (cons >= 7) return true; }
    else cons = 0;
  }
  return false;
}

function hasGrindMonth(data) {
  const months = {};
  for (const [date, val] of Object.entries(data)) {
    const m = date.slice(0, 7);
    if (!months[m]) months[m] = { green: 0, total: 0 };
    months[m].total++;
    if (getEntryColor(val) === "green") months[m].green++;
  }
  return Object.values(months).some(m => m.total >= 20 && m.green / m.total >= 0.8);
}

function hasComeback(data) {
  const sorted = Object.entries(data).sort(([a],[b]) => a.localeCompare(b));
  let reds = 0;
  for (const [,v] of sorted) {
    const c = getEntryColor(v);
    if (c === "red") reds++;
    else if (c === "green" && reds >= 3) return true;
    else reds = 0;
  }
  return false;
}

function calcRawPts(data) {
  return Object.values(data).reduce((sum, v) => {
    const color = typeof v === "object" ? v?.color : v;
    return sum + (POINTS[color] || 0);
  }, 0);
}

// Normalize entry to just the color string
function getEntryColor(entry) {
  if (!entry) return null;
  return typeof entry === "object" ? entry.color : entry;
}

function buildYearGrid(year) {
  const jan1 = new Date(year, 0, 1);
  const startOffset = jan1.getDay();
  const weeks = [];
  let week = [];
  for (let i = 0; i < startOffset; i++) week.push(null);
  const totalDays = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  for (let d = 0; d < totalDays; d++) {
    const date = new Date(year, 0, d + 1);
    week.push(dateKey(date.getFullYear(), date.getMonth(), date.getDate()));
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function getMonthLabels(year, weeks) {
  const labels = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstReal = week.find(d => d !== null);
    if (firstReal) {
      const m = parseInt(firstReal.slice(5, 7)) - 1;
      if (m !== lastMonth) { labels.push({ month: m, weekIndex: wi }); lastMonth = m; }
    }
  });
  return labels;
}

export default function App() {
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  // Auth state
  const [authUser, setAuthUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("grind_user") || "null"); } catch { return null; }
  });
  const [authScreen, setAuthScreen] = useState("login"); // login, signup, forgot
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem("grind_data") || "{}"); } catch { return {}; }
  });
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("join") ? "leaderboard" : "calendar";
  });

  // Leaderboard state — multi-group
  const [myProfile, setMyProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem("grind_profile") || "null"); } catch { return null; }
  }); // { username, playerIds: [{id, groupId, groupCode, groupName}] }
  const [activeGroupIdx, setActiveGroupIdx] = useState(0); // which group we're viewing
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState(null);
  const [lbScreen, setLbScreen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("join") ? "join" : "groups";
  });
  const [lbUsername, setLbUsername] = useState("");
  const [lbGroupName, setLbGroupName] = useState("");
  const [lbGroupCode, setLbGroupCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("join") || "";
  });
  const [lbActionMsg, setLbActionMsg] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsScreen, setSettingsScreen] = useState("main"); // main, changePassword, feedback
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [heatYear, setHeatYear] = useState(today.getFullYear());
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showAccomplishments, setShowAccomplishments] = useState(false);
  const [accomplishments, setAccomplishments] = useState([]);
  const [newAccomplishment, setNewAccomplishment] = useState("");
  const [tooltip, setTooltip] = useState(null);
  const [pointsPopup, setPointsPopup] = useState(null); // { pts, color, key }

  // ─── AUTH FUNCTIONS ───────────────────────────────────────────────
  async function signUp() {
    if (!authEmail.trim() || !authPassword.trim()) { setAuthMsg("Please fill in all fields."); return; }
    if (authPassword.length < 6) { setAuthMsg("Password must be at least 6 characters."); return; }
    setAuthLoading(true); setAuthMsg("");
    try {
      const res = await sbAuth("signup", { email: authEmail.trim(), password: authPassword });
      const user = res.user || res;
      const token = res.access_token;
      localStorage.setItem("grind_token", token);
      localStorage.setItem("grind_user", JSON.stringify({ id: user.id, email: user.email }));
      setAuthUser({ id: user.id, email: user.email });
      // Migrate any existing local data to Supabase
      const localData = JSON.parse(localStorage.getItem("grind_data") || "{}");
      if (Object.keys(localData).length > 0) await pushDataToSupabase(localData, token);
    } catch(e) { setAuthMsg(e.message); }
    setAuthLoading(false);
  }

  async function signIn() {
    if (!authEmail.trim() || !authPassword.trim()) { setAuthMsg("Please fill in all fields."); return; }
    setAuthLoading(true); setAuthMsg("");
    try {
      const res = await sbAuth("token?grant_type=password", { email: authEmail.trim(), password: authPassword });
      const token = res.access_token;
      const user = res.user;
      localStorage.setItem("grind_token", token);
      localStorage.setItem("grind_user", JSON.stringify({ id: user.id, email: user.email }));
      setAuthUser({ id: user.id, email: user.email });
      // Load data from Supabase
      await loadDataFromSupabase(token);
    } catch(e) { setAuthMsg("Invalid email or password."); }
    setAuthLoading(false);
  }

  async function resetPassword() {
    if (!authEmail.trim()) { setAuthMsg("Please enter your email."); return; }
    setAuthLoading(true); setAuthMsg("");
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim() }),
      });
      setAuthMsg("Check your email for a password reset link.");
    } catch(e) { setAuthMsg("Something went wrong."); }
    setAuthLoading(false);
  }

  function signOut() {
    localStorage.removeItem("grind_token");
    localStorage.removeItem("grind_user");
    setAuthUser(null);
    setAuthEmail("");
    setAuthPassword("");
    setAuthMsg("");
  }

  async function pushDataToSupabase(freshData) {
    try {
      const userId = authUser?.id || JSON.parse(localStorage.getItem("grind_user") || "{}").id;
      if (!userId) return;
      // Upsert using auth token
      await sbFetchAuth(`user_data?user_id=eq.${userId}`, { method: "DELETE" }).catch(() => {});
      await sbFetchAuth("user_data", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, data: freshData }),
      });
    } catch(e) { console.error("Push error", e); }
  }

  async function loadDataFromSupabase(token) {
    setDataLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem("grind_user") || "{}");
      if (!user.id) return;
      const rows = await sbFetchAuth(`user_data?user_id=eq.${user.id}`);
      if (rows?.length > 0) {
        const cloudData = rows[0].data;
        setData(cloudData);
        localStorage.setItem("grind_data", JSON.stringify(cloudData));
      }
    } catch(e) { console.error("Load error", e); }
    setDataLoading(false);
  }
  // ──────────────────────────────────────────────────────────────────

  function save(newData) {
    setData(newData);
    try { localStorage.setItem("grind_data", JSON.stringify(newData)); } catch {}
    // Auto-sync to Supabase if logged in
    if (localStorage.getItem("grind_token")) pushDataToSupabase(newData);
  }

  function openDay(key) {
    if (!key || key > todayKey) return;
    setSelected(data[key]?.color || data[key] || null);
    setShowAccomplishments(false);
    setAccomplishments(data[key]?.accomplishments || []);
    setNewAccomplishment("");
    const [y, m, d] = key.split("-");
    setModal({ key, day: parseInt(d), month: parseInt(m) - 1, year: parseInt(y) });
  }

  function submitDay() {
    if (!selected) return;
    const oldEntry = data[modal.key];
    const oldVal = typeof oldEntry === "object" ? oldEntry?.color : oldEntry;
    const newData = { ...data, [modal.key]: { color: selected, accomplishments } };
    save(newData);
    const gained = POINTS[selected];
    const lost = oldVal ? POINTS[oldVal] : 0;
    const net = gained - lost;
    setPointsPopup({ net, color: selected, key: modal.key });
    setTimeout(() => setPointsPopup(null), 2000);
    setModal(null);
    setSelected(null);
    setShowAccomplishments(false);
    setAccomplishments([]);
    setNewAccomplishment("");
    if (myProfile?.playerIds?.length) syncAllGroups(myProfile, newData);
  }

  function deleteDay() {
    const updated = { ...data };
    delete updated[modal.key];
    save(updated);
    setModal(null);
    setSelected(null);
    setShowAccomplishments(false);
    setAccomplishments([]);
    setNewAccomplishment("");
    if (myProfile?.playerIds?.length) syncAllGroups(myProfile, updated);
  }

  // Generate a random 6-char group code
  function genCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  function saveProfile(profile) {
    setMyProfile(profile);
    localStorage.setItem("grind_profile", JSON.stringify(profile));
  }

  async function syncPoints(playerId, freshData) {
    const d = freshData || data;
    const pts = Math.max(0, calcRawPts(d));
    const streak = calcStreak(d);
    const gDays = Object.values(d).filter(v => getEntryColor(v) === "green").length;
    try {
      await sbFetch(`scores?player_id=eq.${playerId}`, { method: "DELETE" });
      if (Object.keys(d).length > 0) {
        await sbFetch("scores", {
          method: "POST",
          body: JSON.stringify({
            player_id: playerId,
            date: "summary",
            rating: "summary",
            points: pts,
            streak,
            green_days: gDays,
            total_days: Object.keys(d).length,
          }),
        });
      }
    } catch(e) { console.error("Sync error", e); }
  }

  async function syncAllGroups(profile, freshData) {
    if (!profile?.playerIds?.length) return;
    for (const p of profile.playerIds) {
      await syncPoints(p.id, freshData);
    }
  }

  async function createGroup() {
    if (!lbGroupName.trim()) return;
    setLbActionMsg("Creating...");
    try {
      const usernameToUse = myProfile ? myProfile.username : lbUsername.trim();
      if (!usernameToUse) { setLbActionMsg("Please enter a username."); return; }
      const code = genCode();
      const [group] = await sbFetch("groups", {
        method: "POST",
        body: JSON.stringify({ code, name: lbGroupName.trim() }),
      });
      const [newPlayer] = await sbFetch("players", {
        method: "POST",
        body: JSON.stringify({ username: usernameToUse, group_id: group.id }),
      });
      const newEntry = { id: newPlayer.id, groupId: group.id, groupCode: code, groupName: group.name };
      const updatedProfile = myProfile
        ? { ...myProfile, playerIds: [...myProfile.playerIds, newEntry] }
        : { username: usernameToUse, playerIds: [newEntry] };
      saveProfile(updatedProfile);
      await syncPoints(newPlayer.id);
      setLbActionMsg("");
      setActiveGroupIdx(updatedProfile.playerIds.length - 1);
      setLbScreen("board");
      setLbGroupName("");
    } catch(e) {
      setLbActionMsg("Error: " + e.message);
    }
  }

  async function joinGroup() {
    if (!lbGroupCode.trim()) return;
    setLbActionMsg("Joining...");
    try {
      const usernameToUse = myProfile ? myProfile.username : lbUsername.trim();
      if (!usernameToUse) { setLbActionMsg("Please enter a username."); return; }
      const groups = await sbFetch(`groups?code=eq.${lbGroupCode.trim().toUpperCase()}`);
      if (!groups?.length) { setLbActionMsg("Group code not found."); return; }
      const group = groups[0];
      // Check if already in this group
      if (myProfile?.playerIds?.some(p => p.groupId === group.id)) {
        setLbActionMsg("You're already in this group!");
        return;
      }
      const [newPlayer] = await sbFetch("players", {
        method: "POST",
        body: JSON.stringify({ username: usernameToUse, group_id: group.id }),
      });
      const newEntry = { id: newPlayer.id, groupId: group.id, groupCode: group.code, groupName: group.name };
      const updatedProfile = myProfile
        ? { ...myProfile, playerIds: [...myProfile.playerIds, newEntry] }
        : { username: usernameToUse, playerIds: [newEntry] };
      saveProfile(updatedProfile);
      await syncPoints(newPlayer.id);
      setLbActionMsg("");
      setActiveGroupIdx(updatedProfile.playerIds.length - 1);
      setLbScreen("board");
      setLbGroupCode("");
    } catch(e) {
      setLbActionMsg("Error: " + e.message);
    }
  }

  async function leaveGroup(idx) {
    if (!myProfile) return;
    const updated = { ...myProfile, playerIds: myProfile.playerIds.filter((_,i) => i !== idx) };
    if (updated.playerIds.length === 0) {
      setMyProfile(null);
      localStorage.removeItem("grind_profile");
    } else {
      saveProfile(updated);
    }
    setActiveGroupIdx(0);
    setLbScreen("groups");
  }

  const fetchLeaderboard = useCallback(async (groupIdx) => {
    const idx = groupIdx ?? activeGroupIdx;
    const groupEntry = myProfile?.playerIds?.[idx];
    if (!groupEntry) return;
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      await syncPoints(groupEntry.id);
      const players = await sbFetch(`players?group_id=eq.${groupEntry.groupId}&select=id,username`);
      const scores = await sbFetch(`scores?player_id=in.(${players.map(p=>p.id).join(",")})&date=eq.summary`);
      const merged = players.map(p => {
        const score = scores?.find(s => s.player_id === p.id);
        return {
          id: p.id,
          username: p.username,
          points: score?.points || 0,
          streak: score?.streak || 0,
          greenDays: score?.green_days || 0,
          totalDays: score?.total_days || 0,
          isMe: p.id === groupEntry.id,
        };
      }).sort((a,b) => b.points - a.points);
      setLeaderboardData(merged);
    } catch(e) {
      setLeaderboardError("Couldn't load leaderboard.");
    }
    setLeaderboardLoading(false);
  }, [myProfile, activeGroupIdx, data]);

  useEffect(() => {
    if (view === "leaderboard" && lbScreen === "board" && myProfile) fetchLeaderboard();
  }, [view, lbScreen, activeGroupIdx]);

  const { firstDay, daysInMonth } = getMonthMeta(calYear, calMonth);
  const greenStreak = calcStreak(data);
  const rawPts = calcRawPts(data);
  const { level, progress, needed, totalPts } = getLevelInfo(rawPts);

  const allVals = Object.values(data);
  const totalDays = allVals.length;
  const greenDays = allVals.filter(v => getEntryColor(v) === "green").length;
  const yellowDays = allVals.filter(v => getEntryColor(v) === "yellow").length;
  const redDays = allVals.filter(v => getEntryColor(v) === "red").length;

  const monthPrefix = `${calYear}-${String(calMonth+1).padStart(2,"0")}`;
  const monthEntries = Object.entries(data).filter(([k]) => k.startsWith(monthPrefix));
  const mGreen = monthEntries.filter(([,v]) => getEntryColor(v) === "green").length;
  const mYellow = monthEntries.filter(([,v]) => getEntryColor(v) === "yellow").length;
  const mTotal = monthEntries.length;
  const mPct = mTotal ? (mGreen * 3 + mYellow) / (mTotal * 3) : 0;
  const grade = mPct >= 0.9 ? "A+" : mPct >= 0.8 ? "A" : mPct >= 0.7 ? "B" : mPct >= 0.6 ? "C" : mPct >= 0.5 ? "D" : mTotal === 0 ? "—" : "F";

  const yearWeeks = buildYearGrid(heatYear);
  const monthLabels = getMonthLabels(heatYear, yearWeeks);
  const yearEntries = Object.entries(data).filter(([k]) => k.startsWith(`${heatYear}-`));
  const yGreen = yearEntries.filter(([,v]) => getEntryColor(v) === "green").length;
  const yYellow = yearEntries.filter(([,v]) => getEntryColor(v) === "yellow").length;
  const yRed = yearEntries.filter(([,v]) => getEntryColor(v) === "red").length;
  const yTotal = yearEntries.length;
  const yPct = yTotal ? (yGreen * 3 + yYellow) / (yTotal * 3) : 0;
  const yearGrade = yPct >= 0.9 ? "A+" : yPct >= 0.8 ? "A" : yPct >= 0.7 ? "B" : yPct >= 0.6 ? "C" : yPct >= 0.5 ? "D" : yTotal === 0 ? "—" : "F";

  function cellColor(key) {
    if (!key) return "transparent";
    if (key > todayKey) return "#0d0d0d";
    const v = getEntryColor(data[key]);
    if (v === "green") return "#22c55e";
    if (v === "yellow") return "#eab308";
    if (v === "red") return "#ef4444";
    return "#1a1a1a";
  }

  // ─── AUTH SCREEN ──────────────────────────────────────────────────
  if (!authUser) {
    return (
      <div style={{ minHeight:"100vh", background:"#0a0a0a", color:"#f0ece4", fontFamily:"'DM Mono','Courier New',monospace", display:"flex", flexDirection:"column", justifyContent:"center", maxWidth:480, margin:"0 auto", padding:"40px 24px" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap'); * { box-sizing:border-box; margin:0; padding:0; }`}</style>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, letterSpacing:6, color:"#22c55e", marginBottom:4 }}>GRIND</div>
        <div style={{ fontSize:11, color:"#555", letterSpacing:4, marginBottom:48 }}>TRACK YOUR STANDARD</div>

        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:3, marginBottom:28 }}>
          {authScreen === "login" ? "WELCOME BACK" : authScreen === "signup" ? "CREATE ACCOUNT" : "RESET PASSWORD"}
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:6 }}>EMAIL</div>
            <input value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="you@email.com" type="email" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none" }} />
          </div>

          {authScreen !== "forgot" && (
            <div>
              <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:6 }}>PASSWORD</div>
              <input value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder={authScreen === "signup" ? "Min. 6 characters" : "••••••••"} type="password" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none" }} />
            </div>
          )}

          {authMsg && <div style={{ fontSize:12, color: authMsg.includes("Check your email") ? "#22c55e" : "#ef4444", lineHeight:1.6 }}>{authMsg}</div>}

          <button onClick={authScreen === "login" ? signIn : authScreen === "signup" ? signUp : resetPassword} disabled={authLoading} style={{ padding:"18px", background:"#22c55e", border:"none", borderRadius:12, color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:2, cursor:"pointer", marginTop:4, opacity: authLoading ? 0.7 : 1 }}>
            {authLoading ? "..." : authScreen === "login" ? "LOG IN" : authScreen === "signup" ? "CREATE ACCOUNT" : "SEND RESET LINK"}
          </button>

          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:8, alignItems:"center" }}>
            {authScreen === "login" && (
              <>
                <button onClick={() => { setAuthScreen("signup"); setAuthMsg(""); }} style={{ background:"none", border:"none", color:"#555", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:"pointer" }}>Don't have an account? <span style={{ color:"#22c55e" }}>Sign up</span></button>
                <button onClick={() => { setAuthScreen("forgot"); setAuthMsg(""); }} style={{ background:"none", border:"none", color:"#444", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer" }}>Forgot password?</button>
              </>
            )}
            {authScreen !== "login" && (
              <button onClick={() => { setAuthScreen("login"); setAuthMsg(""); }} style={{ background:"none", border:"none", color:"#555", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:"pointer" }}>← Back to login</button>
            )}
          </div>
        </div>
      </div>
    );
  }
  // ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", color:"#f0ece4", fontFamily:"'DM Mono','Courier New',monospace", display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { display:none; }
        .day-cell { aspect-ratio:1; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:500; transition:transform 0.12s; border:1.5px solid transparent; user-select:none; }
        .day-cell:active { transform:scale(0.88); }
        .day-cell.green { background:#22c55e; color:#0a2e1a; }
        .day-cell.yellow { background:#eab308; color:#2a1f00; }
        .day-cell.red { background:#ef4444; color:#2a0000; }
        .day-cell.empty { background:#1a1a1a; color:#444; }
        .day-cell.future { background:#111; color:#222; cursor:default; }
        .day-cell.today { border-color:#f0ece4 !important; }
        .tab { flex:1; padding:8px 2px; background:none; border:none; color:#555; font-family:'DM Mono',monospace; font-size:10px; cursor:pointer; border-top:2px solid transparent; transition:all 0.2s; letter-spacing:0.05em; text-transform:uppercase; }
        .tab.active { color:#f0ece4; border-top-color:#22c55e; }
        .color-btn { flex:1; padding:20px 8px; border:none; border-radius:12px; font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:1px; cursor:pointer; transition:transform 0.12s, box-shadow 0.12s, opacity 0.12s; opacity:0.35; }
        .color-btn:active { transform:scale(0.95); }
        .color-btn.selected { opacity:1; box-shadow:0 0 0 3px #f0ece4; transform:scale(1.05); }
        .color-btn.green { background:#22c55e; color:#0a2e1a; }
        .color-btn.yellow { background:#eab308; color:#2a1f00; }
        .color-btn.red { background:#ef4444; color:#2a0000; }
        .submit-btn { width:100%; padding:18px; background:#22c55e; color:#0a2e1a; border:none; border-radius:12px; font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:2px; cursor:pointer; }
        .submit-btn:disabled { background:#1a1a1a; color:#333; cursor:not-allowed; }
        .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.9); display:flex; align-items:flex-end; justify-content:center; z-index:100; padding:20px; }
        .modal { background:#111; border-radius:20px 20px 16px 16px; padding:28px 24px; width:100%; max-width:480px; border:1.5px solid #222; animation:slideUp 0.25s ease; }
        @keyframes slideUp { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
        .badge-card { background:#111; border-radius:12px; padding:14px; display:flex; align-items:center; gap:12px; border:1.5px solid #1e1e1e; }
        .badge-card.unlocked { border-color:#22c55e33; background:#0d1a0f; }
        .level-bar-fill { height:100%; background:linear-gradient(90deg,#22c55e,#86efac); border-radius:4px; transition:width 0.6s ease; }
        .heat-cell { border-radius:3px; cursor:pointer; transition:transform 0.1s; flex-shrink:0; }
        .heat-cell:active { transform:scale(0.85); }
        .tooltip { position:fixed; background:#1a1a1a; border:1px solid #333; border-radius:8px; padding:8px 12px; font-size:11px; color:#f0ece4; pointer-events:none; z-index:200; white-space:nowrap; }
        .pts-popup { position:fixed; top:40%; left:50%; transform:translateX(-50%); z-index:300; font-family:'Bebas Neue',sans-serif; font-size:48px; letter-spacing:3px; pointer-events:none; animation:ptsFade 2s ease forwards; }
        @keyframes ptsFade { 0%{opacity:0;transform:translateX(-50%) translateY(0)} 20%{opacity:1;transform:translateX(-50%) translateY(-10px)} 80%{opacity:1;transform:translateX(-50%) translateY(-30px)} 100%{opacity:0;transform:translateX(-50%) translateY(-50px)} }
        .point-row { display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #1a1a1a; }
        .point-row:last-child { border-bottom:none; }
      `}</style>

      {/* HEADER */}
      <div style={{ padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, letterSpacing:3, color:"#22c55e", lineHeight:1 }}>GRIND</div>
          <div style={{ fontSize:11, color:"#444", letterSpacing:2, marginTop:2 }}>TRACK YOUR STANDARD</div>
        </div>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, color:"#555", letterSpacing:2 }}>LEVEL</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:36, color:"#f0ece4", lineHeight:1 }}>{level}</div>
            <div style={{ width:80, height:6, background:"#1a1a1a", borderRadius:4, marginTop:4, overflow:"hidden" }}>
              <div className="level-bar-fill" style={{ width:`${(progress/needed)*100}%` }} />
            </div>
            <div style={{ fontSize:10, color:"#444", marginTop:4 }}>{progress}/{needed} to next</div>
          </div>
          <button onClick={() => { setShowSettings(true); setSettingsScreen("main"); setSettingsMsg(""); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:22, padding:"4px", marginTop:2 }}>⚙️</button>
        </div>
      </div>

      {/* STREAK */}
      {greenStreak >= 2 && (
        <div style={{ margin:"14px 20px 0", background:"#0d1a0f", border:"1px solid #22c55e44", borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:"#86efac", letterSpacing:1 }}>🔥 GREEN STREAK</span>
          <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:"#22c55e", letterSpacing:2 }}>{greenStreak} DAYS</span>
        </div>
      )}

      {/* MAIN */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px 100px" }}>

        {/* CALENDAR */}
        {view === "calendar" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <button onClick={() => { const d=new Date(calYear,calMonth-1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:24, padding:"0 10px" }}>‹</button>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:3 }}>{MONTH_NAMES[calMonth]} {calYear}</div>
                <div style={{ fontSize:12, color:"#22c55e", letterSpacing:1 }}>{mTotal > 0 ? `Grade: ${grade}  ·  ${mGreen}G ${mYellow}Y ${mTotal-mGreen-mYellow}R` : "tap any day to rate it"}</div>
              </div>
              <button onClick={() => { const d=new Date(calYear,calMonth+1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:24, padding:"0 10px" }}>›</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:4 }}>
              {DAY_NAMES.map(d => <div key={d} style={{ textAlign:"center", fontSize:10, color:"#444", letterSpacing:1, padding:"4px 0" }}>{d}</div>)}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array.from({ length: firstDay }).map((_,i) => <div key={`e${i}`} style={{ aspectRatio:1 }} />)}
              {Array.from({ length: daysInMonth }).map((_,i) => {
                const day = i + 1;
                const key = dateKey(calYear, calMonth, day);
                const isToday = key === todayKey;
                const isFuture = key > todayKey;
                const color = getEntryColor(data[key]);
                return (
                  <div key={key} className={`day-cell${color ? ` ${color}` : isFuture ? " future" : " empty"}${isToday ? " today" : ""}`} onClick={() => openDay(key)}>
                    {day}
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex", gap:14, justifyContent:"center", marginTop:16, fontSize:11, color:"#555" }}>
              {[["#22c55e","Locked In"],["#eab308","Decent"],["#ef4444","Off Day"]].map(([bg,label]) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <div style={{ width:10, height:10, borderRadius:3, background:bg }} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LEADERBOARD */}
        {view === "leaderboard" && (
          <div>
            {/* GROUPS LIST */}
            {lbScreen === "groups" && (
              <div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:3, color:"#22c55e", marginBottom:4 }}>SQUAD</div>
                <div style={{ fontSize:12, color:"#555", marginBottom:20 }}>compete with your crew</div>

                {myProfile && myProfile.playerIds.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                    {myProfile.playerIds.map((g, idx) => (
                      <div key={g.id} onClick={() => { setActiveGroupIdx(idx); setLbScreen("board"); }} style={{ background:"#111", border:"1.5px solid #1e1e1e", borderRadius:14, padding:"16px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#f0ece4", letterSpacing:2 }}>{g.groupName}</div>
                          <div style={{ fontSize:10, color:"#555", marginTop:3 }}>Code: <span style={{ color:"#22c55e", letterSpacing:2 }}>{g.groupCode}</span></div>
                        </div>
                        <div style={{ color:"#444", fontSize:20 }}>›</div>
                      </div>
                    ))}
                  </div>
                )}

                {!myProfile && (
                  <div>
                    <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:8 }}>YOUR USERNAME</div>
                    <input value={lbUsername} onChange={e => setLbUsername(e.target.value)} placeholder="e.g. Will" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none", marginBottom:20 }} />
                  </div>
                )}
                {myProfile && (
                  editingUsername ? (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:6 }}>CHANGE USERNAME</div>
                      <div style={{ display:"flex", gap:8 }}>
                        <input value={newUsername} onChange={e => setNewUsername(e.target.value)} autoFocus style={{ flex:1, background:"#111", border:"1.5px solid #22c55e44", borderRadius:10, padding:"12px 14px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:15, outline:"none" }} />
                        <button onClick={async () => {
                          if (!newUsername.trim() || newUsername.trim() === myProfile.username) { setEditingUsername(false); return; }
                          const updated = { ...myProfile, username: newUsername.trim() };
                          saveProfile(updated);
                          for (const p of updated.playerIds) {
                            try { await sbFetch(`players?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ username: newUsername.trim() }) }); } catch(e) {}
                          }
                          setEditingUsername(false);
                        }} style={{ background:"#22c55e", border:"none", borderRadius:10, padding:"12px 16px", color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:16, cursor:"pointer" }}>SAVE</button>
                        <button onClick={() => { setEditingUsername(false); setNewUsername(myProfile.username); }} style={{ background:"#1a1a1a", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"12px 14px", color:"#555", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:"pointer" }}>✕</button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => { setEditingUsername(true); setNewUsername(myProfile.username); }} style={{ background:"#111", border:"1.5px solid #1e1e1e", borderRadius:12, padding:"14px 16px", marginBottom:16, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:10, color:"#555", letterSpacing:1, marginBottom:3 }}>PLAYING AS</div>
                        <div style={{ fontSize:18, color:"#f0ece4", fontFamily:"'Bebas Neue',sans-serif", letterSpacing:2 }}>{myProfile.username}</div>
                      </div>
                      <div style={{ fontSize:12, color:"#444" }}>edit ✎</div>
                    </div>
                  )
                )}

                <div style={{ display:"flex", gap:10 }}>
                  <button onClick={() => { setLbActionMsg(""); setLbScreen("create"); }} style={{ flex:1, padding:"16px", background:"#0d1a0f", border:"1.5px solid #22c55e44", borderRadius:12, cursor:"pointer", fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#22c55e", letterSpacing:2 }}>CREATE</button>
                  <button onClick={() => { setLbActionMsg(""); setLbScreen("join"); }} style={{ flex:1, padding:"16px", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:12, cursor:"pointer", fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#f0ece4", letterSpacing:2 }}>JOIN</button>
                </div>
              </div>
            )}

            {/* CREATE GROUP */}
            {lbScreen === "create" && (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
                  <button onClick={() => { setLbScreen("groups"); setLbActionMsg(""); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:22 }}>‹</button>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, letterSpacing:3 }}>CREATE GROUP</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div>
                    <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:6 }}>GROUP NAME</div>
                    <input value={lbGroupName} onChange={e => setLbGroupName(e.target.value)} placeholder="e.g. The Boys" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none" }} />
                  </div>
                  {lbActionMsg && <div style={{ fontSize:12, color: lbActionMsg.startsWith("Error") ? "#ef4444" : "#22c55e" }}>{lbActionMsg}</div>}
                  <button onClick={createGroup} style={{ padding:"18px", background:"#22c55e", border:"none", borderRadius:12, color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:2, cursor:"pointer", marginTop:8 }}>CREATE</button>
                </div>
              </div>
            )}

            {/* JOIN GROUP */}
            {lbScreen === "join" && (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
                  <button onClick={() => { setLbScreen("groups"); setLbActionMsg(""); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:22 }}>‹</button>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, letterSpacing:3 }}>JOIN GROUP</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {!myProfile && (
                    <div>
                      <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:6 }}>YOUR USERNAME</div>
                      <input value={lbUsername} onChange={e => setLbUsername(e.target.value)} placeholder="e.g. Will" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none" }} />
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:6 }}>GROUP CODE</div>
                    <input value={lbGroupCode} onChange={e => setLbGroupCode(e.target.value.toUpperCase())} placeholder="e.g. AB12CD" maxLength={6} style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:4, outline:"none" }} />
                  </div>
                  {lbActionMsg && <div style={{ fontSize:12, color: lbActionMsg.startsWith("Error") || lbActionMsg.includes("not found") || lbActionMsg.includes("already") ? "#ef4444" : "#22c55e" }}>{lbActionMsg}</div>}
                  <button onClick={joinGroup} style={{ padding:"18px", background:"#22c55e", border:"none", borderRadius:12, color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:2, cursor:"pointer", marginTop:8 }}>JOIN</button>
                </div>
              </div>
            )}

            {/* LEADERBOARD BOARD */}
            {lbScreen === "board" && myProfile?.playerIds?.[activeGroupIdx] && (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
                  <button onClick={() => setLbScreen("groups")} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:22 }}>‹</button>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:3 }}>{myProfile.playerIds[activeGroupIdx].groupName}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
                      <div style={{ fontSize:10, color:"#555" }}>Code: <span style={{ color:"#22c55e", letterSpacing:2 }}>{myProfile.playerIds[activeGroupIdx].groupCode}</span></div>
                      <button
                        onClick={() => {
                          const code = myProfile.playerIds[activeGroupIdx].groupCode;
                          const url = `${window.location.origin}${window.location.pathname}?join=${code}`;
                          if (navigator.share) {
                            navigator.share({ title: "Join my GRIND squad", text: `Join my group on GRIND! Use code ${code} or click the link:`, url });
                          } else {
                            navigator.clipboard.writeText(url);
                            alert("Link copied to clipboard!");
                          }
                        }}
                        style={{ background:"#1a1a1a", border:"1.5px solid #2a2a2a", borderRadius:6, padding:"3px 10px", color:"#22c55e", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:1 }}
                      >SHARE</button>
                    </div>
                  </div>
                </div>

                <button onClick={() => fetchLeaderboard(activeGroupIdx)} style={{ width:"100%", padding:"10px", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, color:"#555", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:1, marginBottom:16 }}>
                  {leaderboardLoading ? "REFRESHING..." : "↻ REFRESH"}
                </button>

                {leaderboardError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:12 }}>{leaderboardError}</div>}

                {leaderboardData.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {leaderboardData.map((p, idx) => (
                      <div key={p.id} style={{ background: p.isMe ? "#0d1a0f" : "#111", border:`1.5px solid ${p.isMe ? "#22c55e44" : "#1e1e1e"}`, borderRadius:14, padding:"16px", display:"flex", alignItems:"center", gap:14 }}>
                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, width:32, textAlign:"center" }}>
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : <span style={{ color:"#333" }}>{idx+1}</span>}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:15, fontWeight:500, color: p.isMe ? "#22c55e" : "#f0ece4" }}>
                            {p.username}{p.isMe ? " (you)" : ""}
                          </div>
                          <div style={{ fontSize:10, color:"#555", marginTop:3 }}>
                            {p.streak > 0 ? `🔥 ${p.streak} streak · ` : ""}{p.greenDays}G · {p.totalDays} days
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:"#22c55e", lineHeight:1 }}>{p.points}</div>
                          <div style={{ fontSize:9, color:"#555" }}>pts</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!leaderboardLoading && leaderboardData.length === 0 && (
                  <div style={{ textAlign:"center", marginTop:40 }}>
                    <div style={{ fontSize:36, marginBottom:12 }}>👥</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:2, color:"#444" }}>NO MEMBERS YET</div>
                    <div style={{ fontSize:12, color:"#333", marginTop:8 }}>Share code: <span style={{ color:"#22c55e" }}>{myProfile.playerIds[activeGroupIdx].groupCode}</span></div>
                  </div>
                )}

                <button onClick={() => leaveGroup(activeGroupIdx)} style={{ width:"100%", marginTop:24, padding:"12px", background:"none", border:"1.5px solid #1a1a1a", borderRadius:10, color:"#333", fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:1 }}>
                  LEAVE GROUP
                </button>
              </div>
            )}
          </div>
        )}

        {/* HEATMAP */}
        {view === "heatmap" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <button onClick={() => setHeatYear(y => y - 1)} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:24, padding:"0 10px" }}>‹</button>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, letterSpacing:3 }}>{heatYear}</div>
                <div style={{ fontSize:12, color:"#22c55e", letterSpacing:1 }}>{yTotal > 0 ? `Year Grade: ${yearGrade}  ·  ${yGreen}G ${yYellow}Y ${yRed}R` : "no entries this year"}</div>
              </div>
              <button onClick={() => setHeatYear(y => y + 1)} style={{ background:"none", border:"none", color:heatYear >= today.getFullYear() ? "#222" : "#555", cursor:heatYear >= today.getFullYear() ? "default" : "pointer", fontSize:24, padding:"0 10px" }}>›</button>
            </div>
            <div style={{ overflowX:"auto", paddingBottom:8 }}>
              <div style={{ position:"relative", minWidth: yearWeeks.length * 13 + "px" }}>
                <div style={{ display:"flex", marginBottom:4, height:16 }}>
                  {yearWeeks.map((week, wi) => {
                    const label = monthLabels.find(l => l.weekIndex === wi);
                    return <div key={wi} style={{ width:11, marginRight:2, flexShrink:0, fontSize:8, color:"#555", letterSpacing:0.5, overflow:"visible", whiteSpace:"nowrap" }}>{label ? MONTH_SHORT[label.month] : ""}</div>;
                  })}
                </div>
                {[0,1,2,3,4,5,6].map(dayOfWeek => (
                  <div key={dayOfWeek} style={{ display:"flex", marginBottom:2 }}>
                    {yearWeeks.map((week, wi) => {
                      const key = week[dayOfWeek];
                      const color = cellColor(key);
                      const isFuture = key && key > todayKey;
                      return (
                        <div key={wi} className="heat-cell" style={{ width:11, height:11, marginRight:2, background:color, opacity:isFuture ? 0.3 : 1 }}
                          onClick={() => key && !isFuture && openDay(key)}
                          onMouseEnter={(e) => {
                            if (!key) return;
                            const v = getEntryColor(data[key]) || "unlogged";
                            const ptLabel = v !== "unlogged" ? ` (${POINTS[v] > 0 ? "+" : ""}${POINTS[v]} pts)` : "";
                            const label = v === "green" ? "🟢 Locked In" : v === "yellow" ? "🟡 Decent" : v === "red" ? "🔴 Off Day" : "· Unlogged";
                            setTooltip({ key, label: label + ptLabel, x: e.clientX, y: e.clientY - 48 });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", gap:12, justifyContent:"center", marginTop:12, fontSize:10, color:"#555" }}>
              {[["#1a1a1a","None"],["#22c55e","Locked In"],["#eab308","Decent"],["#ef4444","Off Day"]].map(([bg,label]) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:10, height:10, borderRadius:2, background:bg }} />
                  {label}
                </div>
              ))}
            </div>
            {yTotal > 0 && (
              <div style={{ marginTop:20 }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:2, color:"#555", marginBottom:12 }}>{heatYear} BREAKDOWN</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
                  {[
                    { label:"GREEN", val:yGreen, color:"#22c55e", pts:`+${yGreen*15}` },
                    { label:"YELLOW", val:yYellow, color:"#eab308", pts:`+${yYellow*5}` },
                    { label:"RED", val:yRed, color:"#ef4444", pts:`-${yRed*10}` },
                  ].map(({ label, val, color, pts }) => (
                    <div key={label} style={{ background:"#111", borderRadius:12, padding:"14px 12px", border:"1.5px solid #1e1e1e", textAlign:"center" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, color, lineHeight:1 }}>{val}</div>
                      <div style={{ fontSize:10, color:"#555", marginTop:4, letterSpacing:1 }}>{label}</div>
                      <div style={{ fontSize:10, color, marginTop:2 }}>{pts} pts</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#111", borderRadius:12, padding:"16px", border:"1.5px solid #1e1e1e" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                    <div style={{ fontSize:11, color:"#555", letterSpacing:1 }}>YEAR GRADE</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#22c55e", letterSpacing:2 }}>{yearGrade}</div>
                  </div>
                  <div style={{ display:"flex", height:12, borderRadius:6, overflow:"hidden", gap:2 }}>
                    {yGreen > 0 && <div style={{ flex:yGreen, background:"#22c55e" }} />}
                    {yYellow > 0 && <div style={{ flex:yYellow, background:"#eab308" }} />}
                    {yRed > 0 && <div style={{ flex:yRed, background:"#ef4444" }} />}
                    {(365 - yTotal) > 0 && <div style={{ flex:365-yTotal, background:"#1a1a1a" }} />}
                  </div>
                  <div style={{ fontSize:10, color:"#444", marginTop:6 }}>{yTotal} of 365 days logged · {Math.round(yGreen/365*100)}% of year locked in</div>
                </div>
              </div>
            )}
            {yTotal === 0 && (
              <div style={{ textAlign:"center", marginTop:40, color:"#333" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:2, color:"#444" }}>NO DATA FOR {heatYear}</div>
                <div style={{ fontSize:12, color:"#333", marginTop:8 }}>Go to Calendar and start logging your days</div>
              </div>
            )}
          </div>
        )}

        {/* STATS */}
        {view === "stats" && (
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:3, color:"#22c55e", marginBottom:20 }}>YOUR STATS</div>

            {/* Total pts card */}
            <div style={{ background:"#0d1a0f", border:"1.5px solid #22c55e33", borderRadius:12, padding:"18px 16px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:4 }}>TOTAL POINTS</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, color:"#22c55e", lineHeight:1 }}>{totalPts}</div>
                <div style={{ fontSize:11, color:"#86efac", marginTop:4 }}>Level {level} · {progress}/{needed} to next</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:8 }}>POINT SYSTEM</div>
                <div style={{ fontSize:12, color:"#22c55e" }}>🟢 +15 pts</div>
                <div style={{ fontSize:12, color:"#eab308", marginTop:4 }}>🟡 +5 pts</div>
                <div style={{ fontSize:12, color:"#ef4444", marginTop:4 }}>🔴 -10 pts</div>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              {[
                { label:"Total Days", val:totalDays, sub:"logged" },
                { label:"Green Days", val:greenDays, sub:`${totalDays ? Math.round(greenDays/totalDays*100) : 0}%`, color:"#22c55e" },
                { label:"Yellow Days", val:yellowDays, sub:`${totalDays ? Math.round(yellowDays/totalDays*100) : 0}%`, color:"#eab308" },
                { label:"Red Days", val:redDays, sub:`-${redDays*10} pts`, color:"#ef4444" },
              ].map(({ label, val, sub, color }) => (
                <div key={label} style={{ background:"#111", borderRadius:12, padding:"18px 16px", border:"1.5px solid #1e1e1e" }}>
                  <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:6 }}>{label.toUpperCase()}</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:38, color:color||"#f0ece4", lineHeight:1 }}>{val}</div>
                  <div style={{ fontSize:11, color:"#444", marginTop:4 }}>{sub}</div>
                </div>
              ))}
            </div>

            <div style={{ background:"#111", borderRadius:12, padding:"18px 16px", border:"1.5px solid #1e1e1e", marginBottom:16 }}>
              <div style={{ fontSize:11, color:"#555", letterSpacing:1, marginBottom:6 }}>CURRENT GREEN STREAK</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:48, color:"#22c55e", lineHeight:1 }}>{greenStreak}</div>
              <div style={{ fontSize:11, color:"#86efac", marginTop:4 }}>consecutive green days</div>
            </div>


          </div>
        )}


      </div>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div style={{ position:"fixed", inset:0, background:"#0a0a0a", zIndex:200, display:"flex", flexDirection:"column", maxWidth:480, margin:"0 auto", fontFamily:"'DM Mono',monospace" }}>
          <div style={{ padding:"20px 20px 16px", display:"flex", alignItems:"center", gap:12, borderBottom:"1px solid #1a1a1a" }}>
            {settingsScreen !== "main" ? (
              <button onClick={() => { setSettingsScreen("main"); setSettingsMsg(""); setNewPassword(""); setConfirmPassword(""); setFeedbackText(""); }} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:26, lineHeight:1 }}>‹</button>
            ) : (
              <button onClick={() => setShowSettings(false)} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:20, lineHeight:1 }}>✕</button>
            )}
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, letterSpacing:3 }}>
              {settingsScreen === "main" ? "SETTINGS" : settingsScreen === "changePassword" ? "CHANGE PASSWORD" : "SEND FEEDBACK"}
            </div>
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"24px 20px" }}>
            {settingsScreen === "main" && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ fontSize:9, color:"#555", letterSpacing:2, marginBottom:4 }}>LOGGED IN AS</div>
                  <div style={{ fontSize:13, color:"#f0ece4" }}>{authUser?.email}</div>
                </div>
                <button onClick={() => { setSettingsScreen("changePassword"); setSettingsMsg(""); }} style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", width:"100%" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:2, color:"#f0ece4" }}>CHANGE PASSWORD</div>
                  <div style={{ color:"#444", fontSize:20 }}>›</div>
                </button>
                <button onClick={() => { setSettingsScreen("feedback"); setSettingsMsg(""); }} style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", width:"100%" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:2, color:"#f0ece4" }}>SEND FEEDBACK</div>
                  <div style={{ color:"#444", fontSize:20 }}>›</div>
                </button>
                <button onClick={signOut} style={{ background:"none", border:"1px solid #2a2a2a", borderRadius:12, padding:"18px", color:"#ef4444", fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:2, cursor:"pointer", marginTop:8 }}>
                  SIGN OUT
                </button>
              </div>
            )}

            {settingsScreen === "changePassword" && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                <div>
                  <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:6 }}>NEW PASSWORD</div>
                  <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" placeholder="Min. 6 characters" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none" }} />
                </div>
                <div>
                  <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:6 }}>CONFIRM PASSWORD</div>
                  <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" placeholder="Repeat new password" style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:14, outline:"none" }} />
                </div>
                {settingsMsg && <div style={{ fontSize:12, color: settingsMsg.includes("updated") ? "#22c55e" : "#ef4444" }}>{settingsMsg}</div>}
                <button onClick={async () => {
                  if (newPassword.length < 6) { setSettingsMsg("Password must be at least 6 characters."); return; }
                  if (newPassword !== confirmPassword) { setSettingsMsg("Passwords don't match."); return; }
                  setSettingsLoading(true);
                  try {
                    const token = localStorage.getItem("grind_token");
                    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                      method: "PUT",
                      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ password: newPassword }),
                    });
                    if (!res.ok) throw new Error("Failed");
                    setSettingsMsg("Password updated successfully!");
                    setNewPassword(""); setConfirmPassword("");
                  } catch(e) { setSettingsMsg("Something went wrong. Try signing out and back in."); }
                  setSettingsLoading(false);
                }} style={{ padding:"18px", background:"#22c55e", border:"none", borderRadius:12, color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:2, cursor:"pointer", opacity: settingsLoading ? 0.7 : 1 }}>
                  {settingsLoading ? "SAVING..." : "UPDATE PASSWORD"}
                </button>
              </div>
            )}

            {settingsScreen === "feedback" && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                <div style={{ fontSize:12, color:"#666", lineHeight:1.8 }}>What's working? What's missing? What would make GRIND better for you?</div>
                <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} placeholder="Type your feedback here..." rows={6} style={{ width:"100%", background:"#111", border:"1.5px solid #2a2a2a", borderRadius:10, padding:"14px 16px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none", resize:"none", lineHeight:1.7 }} />
                {settingsMsg && <div style={{ fontSize:12, color: settingsMsg.includes("Thank") ? "#22c55e" : "#ef4444" }}>{settingsMsg}</div>}
                <button onClick={async () => {
                  if (!feedbackText.trim()) return;
                  setSettingsLoading(true);
                  try {
                    await sbFetchAuth("feedback", {
                      method: "POST",
                      body: JSON.stringify({ user_email: authUser?.email, message: feedbackText.trim(), created_at: new Date().toISOString() }),
                    });
                    setSettingsMsg("Thank you! Your feedback has been sent.");
                    setFeedbackText("");
                  } catch(e) {
                    window.location.href = `mailto:rizinstudios@gmail.com?subject=GRIND Feedback&body=${encodeURIComponent(feedbackText)}`;
                    setSettingsMsg("Thank you! Your feedback has been sent.");
                  }
                  setSettingsLoading(false);
                }} style={{ padding:"18px", background:"#22c55e", border:"none", borderRadius:12, color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:2, cursor:"pointer", opacity: settingsLoading ? 0.7 : 1 }}>
                  {settingsLoading ? "SENDING..." : "SEND FEEDBACK"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* POINTS POPUP */}
      {pointsPopup && (
        <div className="pts-popup" style={{ color: pointsPopup.net > 0 ? "#22c55e" : pointsPopup.net < 0 ? "#ef4444" : "#eab308" }}>
          {pointsPopup.net > 0 ? `+${pointsPopup.net}` : pointsPopup.net} PTS
        </div>
      )}

      {/* TOOLTIP */}
      {tooltip && (
        <div className="tooltip" style={{ left:tooltip.x, top:tooltip.y }}>
          <div style={{ color:"#555", fontSize:10, marginBottom:2 }}>{tooltip.key}</div>
          <div>{tooltip.label}</div>
        </div>
      )}

      {/* RATING MODAL */}
      {modal && (
        <div className="modal-overlay" onClick={() => { setModal(null); setSelected(null); setShowAccomplishments(false); setAccomplishments([]); setNewAccomplishment(""); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxHeight:"85vh", overflowY:"auto" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, letterSpacing:3, marginBottom:16 }}>
              {MONTH_NAMES[modal.month]} {modal.day}, {modal.year}
            </div>

            <div
              onClick={() => setShowAccomplishments(s => !s)}
              style={{ background: showAccomplishments ? "#0d1a0f" : "#141414", border:`1.5px solid ${showAccomplishments ? "#22c55e44" : "#2a2a2a"}`, borderRadius:10, padding:"12px 16px", marginBottom:16, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}
            >
              <div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:2, color: showAccomplishments ? "#22c55e" : "#888" }}>TRACK ACCOMPLISHMENTS</div>
                <div style={{ fontSize:10, color:"#555", marginTop:2 }}>
                  {accomplishments.length > 0 ? `${accomplishments.length} added` : "tap to add your wins"}
                </div>
              </div>
              <div style={{ color: showAccomplishments ? "#22c55e" : "#444", fontSize:16 }}>{showAccomplishments ? "▲" : "▼"}</div>
            </div>

            {showAccomplishments && (
              <div style={{ background:"#0d0d0d", borderRadius:10, padding:"14px", marginBottom:16, border:"1.5px solid #1e1e1e" }}>
                {accomplishments.length > 0 && (
                  <div style={{ marginBottom:12, display:"flex", flexDirection:"column", gap:6 }}>
                    {accomplishments.map((item, idx) => (
                      <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, background:"#111", borderRadius:8, padding:"8px 12px" }}>
                        <div style={{ color:"#22c55e", fontSize:12 }}>✓</div>
                        <div style={{ flex:1, fontSize:13, color:"#d0ccc4" }}>{item}</div>
                        <div onClick={() => setAccomplishments(a => a.filter((_,i) => i !== idx))} style={{ color:"#444", cursor:"pointer", fontSize:18, padding:"0 4px" }}>×</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex", gap:8 }}>
                  <input
                    value={newAccomplishment}
                    onChange={e => setNewAccomplishment(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && newAccomplishment.trim()) { setAccomplishments(a => [...a, newAccomplishment.trim()]); setNewAccomplishment(""); }}}
                    placeholder="Add a win..."
                    style={{ flex:1, background:"#1a1a1a", border:"1.5px solid #2a2a2a", borderRadius:8, padding:"10px 12px", color:"#f0ece4", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none" }}
                  />
                  <button
                    onClick={() => { if (newAccomplishment.trim()) { setAccomplishments(a => [...a, newAccomplishment.trim()]); setNewAccomplishment(""); }}}
                    style={{ background:"#22c55e", border:"none", borderRadius:8, padding:"10px 14px", color:"#0a2e1a", fontFamily:"'Bebas Neue',sans-serif", fontSize:16, cursor:"pointer" }}
                  >ADD</button>
                </div>
              </div>
            )}

            <div style={{ display:"flex", gap:10, marginBottom:16 }}>
              {[["green","LOCKED\nIN"],["yellow","DECENT"],["red","OFF\nDAY"]].map(([color, label]) => (
                <button key={color} className={`color-btn ${color}${selected === color ? " selected" : ""}`} onClick={() => setSelected(color)} style={{ whiteSpace:"pre-line", lineHeight:1.2 }}>
                  {label}
                </button>
              ))}
            </div>
            <button className="submit-btn" disabled={!selected} onClick={submitDay}>SUBMIT</button>
            <div style={{ display:"flex", gap:10, marginTop:12 }}>
              {data[modal.key] && (
                <button onClick={deleteDay} style={{ flex:1, padding:14, background:"none", border:"1.5px solid #2a2a2a", borderRadius:10, color:"#555", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:"pointer", letterSpacing:1 }}>CLEAR</button>
              )}
              <button onClick={() => { setModal(null); setSelected(null); setShowAccomplishments(false); setAccomplishments([]); setNewAccomplishment(""); }} style={{ flex:1, padding:14, background:"none", border:"1.5px solid #2a2a2a", borderRadius:10, color:"#555", fontFamily:"'DM Mono',monospace", fontSize:12, cursor:"pointer", letterSpacing:1 }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"#0a0a0a", borderTop:"1px solid #1a1a1a", display:"flex", padding:"8px 0 20px" }}>
        {[
          { id:"calendar", label:"Calendar", icon:"▦" },
          { id:"heatmap", label:"Year", icon:"◉" },
          { id:"stats", label:"Stats", icon:"◈" },
          { id:"leaderboard", label:"Squad", icon:"⊞" },
        ].map(t => (
          <button key={t.id} className={`tab${view === t.id ? " active" : ""}`} onClick={() => setView(t.id)}>
            <div style={{ fontSize:16, marginBottom:2 }}>{t.icon}</div>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
