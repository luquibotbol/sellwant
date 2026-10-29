const blocked = () => { throw new Error('External fetch is forbidden in test:offline; use an injected transport fixture'); };
globalThis.fetch = Object.assign(blocked, { preconnect: blocked });
