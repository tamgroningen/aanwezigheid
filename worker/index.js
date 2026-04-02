const ADMIN_PASSWORD = 'training2026';

const NAMES = [
  'federer', 'nadal', 'alcaraz', 'sinner', 'thiem', 'williams',
  'swiatek', 'medvedev', 'dimitrov', 'zverev', 'raducanu', 'fritz',
  'sabalenka', 'draper', 'djokovic', 'murray',
];

function generateCode() {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${name}${num}`;
}

function seedData() {
  return { trainers: [] };
}

function validateCode(data, code) {
  if (code === ADMIN_PASSWORD) return { role: 'admin' };
  for (const t of data.trainers) {
    if (t.code === code) return { role: 'trainer', trainer_id: t.id, trainer_name: t.name };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    async function getData() {
      const raw = await env.AANWEZIGHEID.get('data');
      if (!raw) {
        const data = seedData();
        await env.AANWEZIGHEID.put('data', JSON.stringify(data));
        return data;
      }
      return JSON.parse(raw);
    }

    async function saveData(data) {
      await env.AANWEZIGHEID.put('data', JSON.stringify(data));
    }

    // GET /data — public, strips trainer codes
    if (request.method === 'GET' && path === '/data') {
      const data = await getData();
      const pub = JSON.parse(JSON.stringify(data));
      for (const t of pub.trainers) delete t.code;
      return json(pub);
    }

    // POST /login
    if (request.method === 'POST' && path === '/login') {
      const { code } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ ok: false, error: 'Onjuiste code' }, 401);
      if (auth.role === 'admin') {
        return json({ ok: true, ...auth, data });
      }
      // Return only this trainer's data
      const trainer = data.trainers.find(t => t.id === auth.trainer_id);
      return json({ ok: true, ...auth, trainer });
    }

    // POST /attendance — trainer marks attendance for a date
    if (request.method === 'POST' && path === '/attendance') {
      const { code, trainer_id, group_id, date, present_players } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.attendance) group.attendance = {};
      group.attendance[date] = present_players || [];
      await saveData(data);
      return json({ ok: true });
    }

    // POST /cancel — trainer or admin toggles a date as cancelled
    if (request.method === 'POST' && path === '/cancel') {
      const { code, trainer_id, group_id, date, cancel } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.cancelled) group.cancelled = [];
      if (cancel && !group.cancelled.includes(date)) {
        group.cancelled.push(date);
      } else if (!cancel) {
        group.cancelled = group.cancelled.filter(d => d !== date);
      }
      await saveData(data);
      return json({ ok: true });
    }

    // POST /admin/trainer — add or edit trainer
    if (request.method === 'POST' && path === '/admin/trainer') {
      const { code, action, trainer_id, name } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      if (action === 'add') {
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        if (data.trainers.find(t => t.id === id)) return json({ error: 'Trainer bestaat al' }, 400);
        data.trainers.push({ id, name, code: generateCode(), groups: [] });
      } else if (action === 'delete') {
        data.trainers = data.trainers.filter(t => t.id !== trainer_id);
      }
      await saveData(data);
      return json({ ok: true, data });
    }

    // POST /admin/group — add or edit group for a trainer
    if (request.method === 'POST' && path === '/admin/group') {
      const { code, action, trainer_id, group_id, name } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);

      if (action === 'add') {
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        trainer.groups.push({ id, name, players: [], dates: [], cancelled: [], attendance: {} });
      } else if (action === 'delete') {
        trainer.groups = trainer.groups.filter(g => g.id !== group_id);
      }
      await saveData(data);
      return json({ ok: true, data });
    }

    // POST /admin/players — update group players
    if (request.method === 'POST' && path === '/admin/players') {
      const { code, trainer_id, group_id, players } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      group.players = players;
      await saveData(data);
      return json({ ok: true, data });
    }

    // POST /admin/dates — update group dates and cancelled dates
    if (request.method === 'POST' && path === '/admin/dates') {
      const { code, trainer_id, group_id, dates, cancelled } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (dates) group.dates = dates;
      if (cancelled) group.cancelled = cancelled;
      await saveData(data);
      return json({ ok: true, data });
    }

    return json({ error: 'Not found' }, 404);
  },

  // Weekly backup cron (every Sunday at 3:00 AM)
  async scheduled(event, env) {
    const raw = await env.AANWEZIGHEID.get('data');
    if (raw) {
      const date = new Date().toISOString().slice(0, 10);
      await env.AANWEZIGHEID.put(`backup:${date}`, raw);
    }
  },
};
