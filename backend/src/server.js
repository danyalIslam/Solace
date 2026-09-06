require("dotenv").config();
const express = require("express");

const PORT = process.env.PORT;
const app = express();

// Middleware
app.use(express.json());

// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Backend is running!"
    });
});

// Example API route
app.get("/api/users", (req, res) => {
    res.json([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" }
    ]);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});