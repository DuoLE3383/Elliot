module.exports = [
"[project]/src/lib/session-broadcast.ts [instrumentation] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/[root-of-the-server]__7f6458a7._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/src/lib/session-broadcast.ts [instrumentation] (ecmascript)");
    });
});
}),
"[project]/src/lib/engine.ts [instrumentation] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/[root-of-the-server]__38529186._.js",
  "server/chunks/[externals]_@prisma_client_c5ee037a._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/src/lib/engine.ts [instrumentation] (ecmascript)");
    });
});
}),
];