require('dotenv').config();
const ngrok = require('ngrok');
const { spawn } = require('child_process');

(async function () {
    try {
        // Start Ngrok tunnel
        const url = await ngrok.connect(process.env.PORT || 4000);
        console.log(`🚀 Ngrok tunnel URL: ${url}`);

        // Set BASE_URL dynamically in the process environment
        process.env.BASE_URL = url;
        console.log(`🌍 Updated BASE_URL: ${process.env.BASE_URL}`);

        // Start the server with the new BASE_URL
        const server = spawn('node', ['app.js'], { stdio: 'inherit', env: process.env });

        server.on('close', (code) => {
            console.log(`❌ Server process exited with code ${code}`);
        });

    } catch (error) {
        console.error('❌ Error starting ngrok:', error);
    }
})();
