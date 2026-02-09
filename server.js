        res.json({ jobId });
    });
});

app.post("/api/image/start/:action", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        const jobId = Date.now().toString();
        const files = req.files || [];
        if (files.length > 0) {
            jobs[jobId] = { status: "completed", progress: 100, downloadUrl: `/uploads/${files[0].filename}` };
        } else {
            jobs[jobId] = { status: "failed", error: "No files provided" };
        }
        res.json({ jobId });
    });
});

app.get("/api/process/status/:id", (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ status: "not_found" });
    res.json(job);
});

app.get("/api/download/:file", (req, res) => {
    const filePath = path.join(OUTPUT_DIR, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado.");
    res.download(filePath);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Turbo Server Running on Port ${PORT}`);
});
