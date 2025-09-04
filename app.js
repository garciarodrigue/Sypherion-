// ---------- CONFIGS ----------
// RTDB (chat/map)
const firebaseConfigRT = {
  apiKey: "AIzaSyCsM5ynPDbJCUV7HXq5NA3mmIXKxczc_RA",
  authDomain: "sypherionmaps.firebaseapp.com",
  databaseURL: "https://sypherionmaps-default-rtdb.firebaseio.com",
  projectId: "sypherionmaps",
  storageBucket: "sypherionmaps.firebasestorage.app",
  messagingSenderId: "529754955214",
  appId: "1:529754955214:web:c6b25dbafc9172eeb8df9f"
};

// Firestore perfiles
const firebaseConfigProfiles = {
  apiKey: "AIzaSyDDqmxexQ3l6EGRMaxznWodR8UqBCrQOQQ",
  authDomain: "inst-a22d0.firebaseapp.com",
  projectId: "inst-a22d0",
  storageBucket: "inst-a22d0.firebasestorage.app",
  messagingSenderId: "819027254414",
  appId: "1:819027254414:web:fe71f2c63ba92ee82afddf"
};

// Inicializar app por defecto (RTDB)
const defaultApp = firebase.initializeApp(firebaseConfigRT);
const rdb = firebase.database();

// Inicializar app separada para perfiles (Firestore compat)
const profilesApp = firebase.initializeApp(firebaseConfigProfiles, 'profilesApp');
const profilesDb = firebase.firestore(profilesApp);

// ---------- MAPA (Leaflet) ----------
const map = L.map('map').setView([14.6349, -90.5069], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap & Carto',
  maxZoom: 20
}).addTo(map);

// ---------- ESTADO ----------
const users = {};
const userMarkers = {};
let me = { key: '', nick: '', lat: null, lon: null, country: '', city: '', region: '' };

// UI refs
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const usersListEl = document.getElementById('usersList');
const topicInput = document.getElementById('topicInput');
const messageInput = document.getElementById('messageInput');
const nickInput = document.getElementById('nick');
const startBtn = document.getElementById('startBtn');

// toggle sidebar
toggleSidebarBtn.addEventListener('click', () => sidebar.classList.remove('hidden'));
closeSidebarBtn.addEventListener('click', () => sidebar.classList.add('hidden'));

// toast
function toast(text, ms = 5000) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// upsert marker
function upsertUserMarker(key, data) {
  if (!data || data.latitude == null || data.longitude == null) return;
  const color = data.online ? '#00ff66' : '#ff4d4d';
  if (!userMarkers[key]) {
    userMarkers[key] = L.circleMarker([data.latitude, data.longitude], {
      radius: 8, color, fillColor: color, fillOpacity: 0.9
    }).addTo(map).bindPopup(`${data.nick || '(sin-nick)'}${key === me.key ? ' (Tú)' : ''}`);
  } else {
    userMarkers[key].setLatLng([data.latitude, data.longitude]).setStyle({ color, fillColor: color });
    userMarkers[key].setPopupContent(`${data.nick || '(sin-nick)'}${key === me.key ? ' (Tú)' : ''}`);
  }
}

// render list
function renderUserList() {
  usersListEl.innerHTML = '';
  Object.entries(users).forEach(([k, u]) => {
    const div = document.createElement('div');
    div.className = 'userRow';
    const dot = document.createElement('div');
    dot.className = 'dot ' + (u.online ? 'on' : 'off');
    const text = document.createElement('div');
    text.innerHTML = `<strong style="color:var(--neon)">${u.nick || 'anon'}</strong><div class="muted">${u.city || ''} ${u.country || ''}</div>`;
    div.appendChild(dot);
    div.appendChild(text);
    usersListEl.appendChild(div);
  });
}

// listen usuarios RTDB
rdb.ref('usuarios_online').on('value', snap => {
  const val = snap.val() || {};
  // Limpiar usuarios que ya no están
  Object.keys(users).forEach(k => {
    if (!val[k]) {
      delete users[k];
      if (userMarkers[k]) {
        map.removeLayer(userMarkers[k]);
        delete userMarkers[k];
      }
    }
  });
  
  // Agregar/actualizar usuarios
  Object.keys(val).forEach(k => {
    users[k] = val[k];
    if (!users[k].region) {
      users[k].region = ((users[k].country || '') + (users[k].city || '')).replace(/\s+/g, '').replace(/\//g, '');
    }
    upsertUserMarker(k, users[k]);
  });
  renderUserList();
});

// LÍNEAS (dibujar + limpiar)
function drawLine(fromLatLon, toLatLon, color = '#0af') {
  const line = L.polyline([fromLatLon, toLatLon], { color, weight: 3 }).addTo(map);
  setTimeout(() => map.removeLayer(line), 60000);
}

rdb.ref('lineas').on('child_added', snap => {
  const LN = snap.val();
  if (!LN) return;
  drawLine([LN.fromLat, LN.fromLon], [LN.toLat, LN.toLon], LN.color || '#0af');
  const now = Date.now();
  const ttl = 60000;
  if ((now - (LN.timestamp || now)) > ttl) {
    rdb.ref('lineas/' + snap.key).remove();
  } else {
    setTimeout(() => rdb.ref('lineas/' + snap.key).remove(), ttl - (now - (LN.timestamp || now)));
  }
});

// Conectar usuario (alta/actualización)
async function connectUser(nick) {
  if (!navigator.geolocation) return alert('No soporta geolocalización');
  me.nick = nick;
  
  navigator.geolocation.getCurrentPosition(async pos => {
    me.lat = pos.coords.latitude;
    me.lon = pos.coords.longitude;
    
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${me.lat}&lon=${me.lon}&format=json`);
      const j = await res.json();
      me.country = j.address?.country || 'Unknown';
      me.city = j.address?.city || j.address?.town || j.address?.village || 'Unknown';
      me.region = (me.country + me.city).replace(/\s+/g, '').replace(/\//g, '');
    } catch (e) {
      me.country = 'Unknown';
      me.city = 'Unknown';
      me.region = 'UnknownUnknown';
    }

    const usersRef = rdb.ref('usuarios_online');
    usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
      if (snap.exists()) {
        snap.forEach(ch => {
          me.key = ch.key;
          rdb.ref('usuarios_online/' + me.key).update({
            nick: me.nick,
            latitude: me.lat,
            longitude: me.lon,
            country: me.country,
            city: me.city,
            region: me.region,
            online: true,
            timestamp: Date.now()
          });
        });
      } else {
        const newRef = usersRef.push();
        me.key = newRef.key;
        newRef.set({
          nick: me.nick,
          latitude: me.lat,
          longitude: me.lon,
          country: me.country,
          city: me.city,
          region: me.region,
          online: true,
          timestamp: Date.now()
        });
      }
    });

    map.setView([me.lat, me.lon], 13);

    // pulso anillo
    const ring = L.circle([me.lat, me.lon], {
      color: '#00ff66',
      fillColor: '#00ff66',
      fillOpacity: 0.18,
      radius: 100
    }).addTo(map);
    
    let grow = true;
    const pulseInterval = setInterval(() => {
      let r = ring.getRadius();
      if (r >= 200) grow = false;
      if (r <= 100) grow = true;
      ring.setRadius(grow ? r + 4 : r - 4);
    }, 120);

    // periódica actualización de ubicación
    const updateInterval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(p => {
        const la = p.coords.latitude;
        const lo = p.coords.longitude;
        me.lat = la;
        me.lon = lo;
        if (me.key) {
          rdb.ref('usuarios_online/' + me.key).update({
            latitude: la,
            longitude: lo,
            timestamp: Date.now()
          });
        }
        ring.setLatLng([la, lo]);
        if (userMarkers[me.key]) userMarkers[me.key].setLatLng([la, lo]);
      });
    }, 5000);

    // Guardar intervalos para limpiar después
    window._intervals = window._intervals || [];
    window._intervals.push(pulseInterval, updateInterval);

    toast('Conectado como ' + me.nick, 3500);
  }, err => alert('No se pudo obtener ubicación: ' + err.message));
}

// MENSAJERÍA
const MENSAJES_PATH = 'mensajes';
const LINEAS_PATH = 'lineas';

function encontrarDestino(topic) {
  let targetUser = null;
  let regionUsers = [];
  const topicReg = topic.replace(/\s+/g, '').replace(/\//g, '');
  
  for (const k in users) {
    const u = users[k];
    const reg = u.region || ((u.country || '') + (u.city || '')).replace(/\s+/g, '').replace(/\//g, '');
    if (u.nick === topic) targetUser = { ...u, key: k };
    if (reg === topicReg) regionUsers.push({ ...u, key: k });
  }
  
  return { targetUser, regionUsers, topicRegion: topicReg };
}

function centroid(arr) {
  if (!arr.length) return null;
  let sx = 0;
  let sy = 0;
  arr.forEach(u => {
    sx += u.latitude;
    sy += u.longitude;
  });
  return [sx / arr.length, sy / arr.length];
}

async function enviarMensaje(topic, text) {
  if (!me.key) return alert('Conéctate primero');
  if (!text) return alert('Escribe un mensaje');
  
  const { targetUser, regionUsers, topicRegion } = encontrarDestino(topic);

  let tipo = '';
  let to = '';
  let toLatLon = null;
  let color = '#0af';
  
  if (targetUser) {
    tipo = 'user';
    to = targetUser.nick;
    color = '#0af';
    toLatLon = [targetUser.latitude, targetUser.longitude];
  } else if (regionUsers.length) {
    tipo = 'region';
    to = topicRegion;
    color = '#e67e22';
    toLatLon = centroid(regionUsers);
  } else {
    return alert('Topic desconocido');
  }

  const now = Date.now();
  const msgRef = rdb.ref(MENSAJES_PATH).push();
  const msgObj = {
    from: me.nick,
    to,
    type: tipo,
    text,
    timestamp: now,
    expiresAt: now + 3600000
  };
  
  msgRef.set(msgObj);

  const lnRef = rdb.ref(LINEAS_PATH).push();
  const ln = {
    fromLat: me.lat,
    fromLon: me.lon,
    toLat: toLatLon[0],
    toLon: toLatLon[1],
    color,
    timestamp: now
  };
  
  lnRef.set(ln);
  setTimeout(() => rdb.ref(LINEAS_PATH + '/' + lnRef.key).remove(), 60000);

  toast(`Enviado → ${to}`, 3000);
}

// Escuchar mensajes (mostrar solo a destinatarios)
rdb.ref(MENSAJES_PATH).on('child_added', snap => {
  const m = snap.val();
  if (!m) return;
  
  const now = Date.now();
  const ttl = 3600000;
  
  if ((now - (m.timestamp || now)) > ttl) {
    rdb.ref(MENSAJES_PATH + '/' + snap.key).remove();
    return;
  } else {
    setTimeout(() => rdb.ref(MENSAJES_PATH + '/' + snap.key).remove(), (m.expiresAt || m.timestamp + ttl) - now);
  }

  if (m.type === 'user' && me.nick && m.to === me.nick) {
    toast(`${m.from}: ${m.text}`, 15000);
  } else if (m.type === 'region' && me.region && m.to === me.region) {
    toast(`[${m.to}] ${m.from}: ${m.text}`, 15000);
  }
});

// UI events: send
document.getElementById('sendBtn').addEventListener('click', () => {
  const topic = topicInput.value.trim();
  const msg = messageInput.value.trim();
  if (!topic || !msg) return alert('Topic y mensaje requeridos');
  enviarMensaje(topic, msg);
  messageInput.value = '';
});

// UI events: start tracking
startBtn.addEventListener('click', () => {
  const nick = nickInput.value.trim();
  if (!nick) return alert('Escribe tu Nick');
  connectUser(nick);
});

// marcar offline al cerrar
window.addEventListener('beforeunload', () => {
  if (me.key) {
    rdb.ref('usuarios_online/' + me.key).update({
      online: false,
      timestamp: Date.now()
    });
  }
  
  // Limpiar intervalos
  if (window._intervals) {
    window._intervals.forEach(clearInterval);
  }
});

// Periodic cleanup (client-side)
setInterval(() => {
  const cutoffMsg = Date.now() - 3600000;
  rdb.ref(MENSAJES_PATH).once('value', snap => {
    snap.forEach(ch => {
      const v = ch.val();
      if (v && (v.timestamp || 0) < cutoffMsg) ch.ref.remove();
    });
  });
  
  const cutoffLine = Date.now() - 60000;
  rdb.ref(LINEAS_PATH).once('value', snap => {
    snap.forEach(ch => {
      const v = ch.val();
      if (v && (v.timestamp || 0) < cutoffLine) ch.ref.remove();
    });
  });
}, 120000);

// ---------- PERFIL (Firestore compat - profilesApp) ----------
const avatarFile = document.getElementById('avatarFile');
const avatarPreview = document.getElementById('avatarPreview');
let avatarBase64 = '';

// referencia doc
const perfilDocRef = profilesDb.collection('perfiles').doc('perfil1');

// escucha en tiempo real (actualiza UI cuando cambie en Firestore)
perfilDocRef.onSnapshot(docSnap => {
  if (!docSnap.exists) return;
  
  const data = docSnap.data() || {};
  document.getElementById('nameInput').value = data.name || '';
  document.getElementById('usernameInput').value = data.username || '';
  document.getElementById('bioInput').value = data.bio || '';
  document.getElementById('websiteInput').value = data.website || '';
  document.getElementById('postsInput').value = data.posts || 0;
  document.getElementById('followersInput').value = data.followers || 0;
  document.getElementById('followingInput').value = data.following || 0;
  document.getElementById('gmailDisplay').textContent = data.gmail || '—';
  document.getElementById('passwordDisplay').textContent = data.password || '—';
  
  if (data.avatarBase64) {
    avatarBase64 = data.avatarBase64;
    avatarPreview.src = data.avatarBase64;
  }
});

// convertir avatar a base64
avatarFile.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  
  const reader = new FileReader();
  reader.onload = ev => {
    avatarBase64 = ev.target.result;
    avatarPreview.src = avatarBase64;
  };
  reader.readAsDataURL(f);
});

// guardar perfil (merge para no borrar gmail/password)
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  const payload = {
    name: document.getElementById('nameInput').value,
    username: document.getElementById('usernameInput').value,
    bio: document.getElementById('bioInput').value,
    website: document.getElementById('websiteInput').value,
    posts: Number(document.getElementById('postsInput').value) || 0,
    followers: Number(document.getElementById('followersInput').value) || 0,
    following: Number(document.getElementById('followingInput').value) || 0,
    avatarBase64: avatarBase64 || null
  };
  
  try {
    await perfilDocRef.set(payload, { merge: true });
    toast('Perfil guardado en Firestore', 2500);
  } catch (err) {
    console.error(err);
    alert('Error guardando perfil');
  }
});
