/* FlashRush courier API client — drop-in layer for the UI.
   Examples:
     await FlashRush.login('alex@flashrush.app','password123')
     const { quote } = await FlashRush.quote({ pickup, dropoff, size:'medium', tip:4 })
     const { delivery } = await FlashRush.book({ pickup, dropoff, size:'medium', recipient_name:'Dan', recipient_phone:'...' })
     FlashRush.track(delivery.id, (event, data) => console.log(event, data))
*/
(function (global) {
  const API = (location.origin || 'http://localhost:3000') + '/api';
  let token = localStorage.getItem('fr_token') || null;

  async function req(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function ws(topic, onEvent) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.host || 'localhost:3000';
    const sock = new WebSocket(`${proto}://${host}/ws?token=${token}`);
    sock.onopen = () => sock.send(JSON.stringify({ type: 'subscribe', topic }));
    sock.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.type === 'event') onEvent(msg.event, msg.data); };
    return sock;
  }

  const FlashRush = {
    get token() { return token; },
    setToken(t) { token = t; t ? localStorage.setItem('fr_token', t) : localStorage.removeItem('fr_token'); },

    register(p) { return req('/auth/register', { method: 'POST', body: p }).then(d => (this.setToken(d.token), d)); },
    login(email, password) { return req('/auth/login', { method: 'POST', body: { email, password } }).then(d => (this.setToken(d.token), d)); },
    logout() { this.setToken(null); },
    me() { return req('/auth/me'); },

    // Courier
    quote(body) { return req('/deliveries/quote', { method: 'POST', body }); },     // public, no login needed
    book(body) { return req('/deliveries', { method: 'POST', body }); },
    deliveries() { return req('/deliveries'); },
    delivery(id) { return req(`/deliveries/${id}`); },
    accept(id) { return req(`/deliveries/${id}/accept`, { method: 'POST' }); },
    setStatus(id, status) { return req(`/deliveries/${id}/status`, { method: 'PATCH', body: { status } }); },
    pingLocation(id, lat, lng) { return req(`/deliveries/${id}/location`, { method: 'POST', body: { lat, lng } }); },
    rate(id, rating) { return req(`/deliveries/${id}/rate`, { method: 'POST', body: { rating } }); },

    // Payments
    payIntent(delivery_id) { return req('/payments/intent', { method: 'POST', body: { delivery_id } }); },
    confirmMock(delivery_id) { return req('/payments/confirm-mock', { method: 'POST', body: { delivery_id } }); },

    admin: {
      overview() { return req('/admin/overview'); },
      drivers() { return req('/admin/drivers'); },
      customers() { return req('/admin/customers'); },
      zones() { return req('/admin/zones'); },
      setZone(id, body) { return req(`/admin/zones/${id}`, { method: 'PATCH', body }); },
      revenue() { return req('/admin/revenue'); },
    },

    // Real-time
    track(deliveryId, onEvent) { return ws(`delivery:${deliveryId}`, onEvent); },   // customers follow their parcel
    watchQueue(onEvent) { return ws('drivers:queue', onEvent); },                    // couriers watch for jobs
  };

  global.FlashRush = FlashRush;
})(window);
