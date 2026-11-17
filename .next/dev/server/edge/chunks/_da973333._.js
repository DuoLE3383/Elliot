(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(["chunks/_da973333._.js",
"[project]/src/instrumentation.ts [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// Next.js instrumentation hook — runs once when the server boots (Node runtime).
// Two jobs, both "make the app work on real VPS boxes":
//   1. Load .env manually. `next dev` / `next start` and systemd's
//      EnvironmentFile read .env files, but the STANDALONE server
//      (`bun run start` → node .next/standalone/server.js) does NOT — env vars
//      like TELEGRAM_* / DATABASE_URL / DATA_DIR in the repo .env were silently
//      ignored in manual deployments. We parse the file ourselves and only fill
//      variables that are not already set (systemd / shell always win).
//   2. IPv4-first for ALL outbound lookups. Some VPS / ISP routes have a broken
//      IPv6 path to api.telegram.org which manifests as 503s, hangs or timeouts
//      — IPv4-first removes that failure mode. Safe: hosts without A records
//      still resolve to their AAAA records.
__turbopack_context__.s([
    "register",
    ()=>register
]);
/** Minimal dotenv parser: KEY=VALUE, optional quotes, # comments ignored. */ function loadDotenv() {
    try {
        const g = process;
        const fs = g.getBuiltinModule?.("node:fs");
        const path = g.getBuiltinModule?.("node:path");
        if (!fs || !path) return;
        // server.js chdirs into .next/standalone → repo .env sits two levels up.
        // MERGE every candidate (closest first, first-seen key wins) instead of
        // "first file wins" — a stale .env sitting inside .next/standalone must
        // not shadow the repo .env for keys it doesn't define.
        const candidates = [
            path.resolve(".env"),
            path.resolve("../..", ".env")
        ];
        for (const file of candidates){
            if (!fs.existsSync(file)) continue;
            const text = fs.readFileSync(file, "utf8");
            for (const line of text.split("\n")){
                const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
                if (!m) continue;
                let v = m[2];
                if (v.startsWith('"') && v.endsWith('"') && v.length >= 2 || v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
                    v = v.slice(1, -1);
                }
                // set even EMPTY values (KEY= clears a var) — but never override
                // something the shell/systemd already provided
                if (process.env[m[1]] === undefined) process.env[m[1]] = v;
            }
        }
    } catch  {
    // unreadable .env — env vars set the normal way still work
    }
}
async function register() {
    if ("TURBOPACK compile-time truthy", 1) return;
    //TURBOPACK unreachable
    ;
}
}),
"[project]/node_modules/next/dist/esm/build/templates/edge-wrapper.js { MODULE => \"[project]/src/instrumentation.ts [instrumentation-edge] (ecmascript)\" } [instrumentation-edge] (ecmascript)", ((__turbopack_context__, module, exports) => {

// The wrapped module could be an async module, we handle that with the proxy
// here. The comma expression makes sure we don't call the function with the
// module as the "this" arg.
// Turn exports into functions that are also a thenable. This way you can await the whole object
// or  exports (e.g. for Components) or call them directly as though they are async functions
// (e.g. edge functions/middleware, this is what the Edge Runtime does).
// Catch promise to prevent UnhandledPromiseRejectionWarning, this will be propagated through
// the awaited export(s) anyway.
self._ENTRIES ||= {};
const modProm = Promise.resolve().then(()=>__turbopack_context__.i("[project]/src/instrumentation.ts [instrumentation-edge] (ecmascript)"));
modProm.catch(()=>{});
self._ENTRIES["middleware_instrumentation"] = new Proxy(modProm, {
    get (innerModProm, name) {
        if (name === 'then') {
            return (res, rej)=>innerModProm.then(res, rej);
        }
        let result = (...args)=>innerModProm.then((mod)=>(0, mod[name])(...args));
        result.then = (res, rej)=>innerModProm.then((mod)=>mod[name]).then(res, rej);
        return result;
    }
}); //# sourceMappingURL=edge-wrapper.js.map
}),
]);

//# sourceMappingURL=_da973333._.js.map