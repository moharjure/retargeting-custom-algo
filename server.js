const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Weights for scoring events - adjust these to change ranking behavior
const EVENT_WEIGHTS = {
    ProductAddToCart: 10,
    ProductDetailsView: 5,
    Purchase: -100, // negative = exclude purchased products
    MyCustomEvent: 15, // your custom event gets highest priority
    MyCustomWishlistEvent: 20, // wishlist gets even higher priority
};
const DEFAULT_WEIGHT = 1;

// Half-life in days for recency decay
const RECENCY_HALF_LIFE_DAYS = 7;

function scoreEvents(events, requestedItems) {
    const scores = {};
    const purchased = new Set();
    const now = Math.floor(Date.now() / 1000);

    for (const event of events) {
        // Extract product IDs depending on event structure
        const ids = event.productIds
            || (event.data?.products?.map(p => p.id))
            || (event.data?.id ? [event.data.id] : []);

        if (event.name === 'Purchase') {
            ids.forEach(id => purchased.add(id));
            continue;
        }

        const weight = EVENT_WEIGHTS[event.name] ?? DEFAULT_WEIGHT;
        const ageInDays = (now - event.timestamp) / 86400;
        const recency = Math.pow(0.5, ageInDays / RECENCY_HALF_LIFE_DAYS);

        for (const id of ids) {
            scores[id] = (scores[id] || 0) + weight * recency;
        }
    }

    const ranked = Object.entries(scores)
        .filter(([id]) => !purchased.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, requestedItems)
        .map(([id, score]) => ({ id, score }));

    return ranked;
}

const server = http.createServer((req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    // Only handle POST /recommend
    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
    }

    const parsed = url.parse(req.url, true);
    const requestedItems = parseInt(parsed.query.requestedItems) || 3;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        const timestamp = new Date().toISOString();

        let events;
        try {
            const payload = JSON.parse(body);
            events = payload.events || [];
        } catch (e) {
            console.error(`[${timestamp}] Failed to parse request body:`, e.message);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end('[]');
            return;
        }

        // Log everything for debugging
        console.log(`\n${'='.repeat(60)}`);
        console.log(`[${timestamp}] Incoming request`);
        console.log(`  Path: ${req.url}`);
        console.log(`  requestedItems: ${requestedItems}`);
        console.log(`  Total events: ${events.length}`);
        console.log(`  Event breakdown:`);

        const byType = {};
        for (const e of events) {
            byType[e.name] = (byType[e.name] || 0) + 1;
        }
        for (const [name, count] of Object.entries(byType)) {
            console.log(`    ${name}: ${count}`);
        }

        // Log MyCustomEvent details specifically
        const myEvents = events.filter(e => e.name === 'MyCustomEvent');
        if (myEvents.length > 0) {
            console.log(`\n  >>> MyCustomEvent details:`);
            for (const e of myEvents) {
                console.log(`    timestamp: ${e.timestamp} (${new Date(e.timestamp * 1000).toISOString()})`);
                console.log(`    data: ${JSON.stringify(e.data)}`);
                console.log(`    productIds: ${JSON.stringify(e.productIds)}`);
            }
        } else {
            console.log(`\n  >>> No MyCustomEvent found in this request`);
        }

        // Log MyCustomWishlistEvent details specifically
        const wishlistEvents = events.filter(e => e.name === 'MyCustomWishlistEvent');
        if (wishlistEvents.length > 0) {
            console.log(`\n  >>> MyCustomWishlistEvent details:`);
            for (const e of wishlistEvents) {
                console.log(`    timestamp: ${e.timestamp} (${new Date(e.timestamp * 1000).toISOString()})`);
                console.log(`    data: ${JSON.stringify(e.data)}`);
                console.log(`    productIds: ${JSON.stringify(e.productIds)}`);
            }
        } else {
            console.log(`\n  >>> No MyCustomWishlistEvent found in this request`);
        }

        // Score and rank
        const ranked = scoreEvents(events, requestedItems);
        const result = ranked.map(r => r.id);

        console.log(`\n  Scoring:`);
        for (const r of ranked) {
            console.log(`    ${r.id}: ${r.score.toFixed(2)}`);
        }
        console.log(`  Response: ${JSON.stringify(result)}`);
        console.log('='.repeat(60));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    });
});

server.listen(PORT, () => {
    console.log(`Custom algo POC listening on port ${PORT}`);
    console.log(`Endpoint: POST http://localhost:${PORT}/recommend?requestedItems=N`);
    console.log(`Health:   GET  http://localhost:${PORT}/health`);
    console.log(`\nWaiting for requests...\n`);
});
