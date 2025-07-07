const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Store running studio processes
const runningStudios = new Map();

router.post('/launch/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id) {
        return res.json({ status: false, message: 'Bad Request: Missing Parameter ID' });
    }

    // Check if studio is already running for this database
    if (runningStudios.has(id)) {
        const studio = runningStudios.get(id);
        return res.json({ 
            status: true, 
            message: 'Studio is already running for this database',
            port: studio.port,
            url: `http://localhost:${studio.port}`
        });
    }

    // Load database configuration
    const dataPath = path.join(__dirname, '../../data');
    const filePath = path.join(dataPath, `${id}.json`);
    console.log(`Loading database configuration from: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        return res.json({ status: false, message: 'Not Found: Database configuration does not exist' });
    }

    try {
        const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // Find available port (starting from 4000)
        const port = findAvailablePort();
        
        // Create Drizzle config file for this database
        const drizzleConfigPath = createDrizzleConfig(id, config);
        
        // Launch Drizzle Studio
        const studioProcess = spawn('npx', ['drizzle-kit', 'studio', '--config', drizzleConfigPath, '--port', port.toString()], {
            cwd: path.join(__dirname, '../..'),
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        studioProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        studioProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        // Store the process
        runningStudios.set(id, {
            process: studioProcess,
            port: port,
            configPath: drizzleConfigPath
        });

        // Handle process events
        studioProcess.on('error', (error) => {
            console.error(`Studio process error for ${id}:`, error);
            console.error(`Stdout: ${stdout}`);
            console.error(`Stderr: ${stderr}`);
            runningStudios.delete(id);
            cleanupDrizzleConfig(drizzleConfigPath);
        });

        studioProcess.on('exit', (code) => {
            console.log(`Studio process for ${id} exited with code ${code}`);
            if (code !== 0) {
                console.error(`Stdout: ${stdout}`);
                console.error(`Stderr: ${stderr}`);
            }
            runningStudios.delete(id);
            cleanupDrizzleConfig(drizzleConfigPath);
        });

        // Give the process a moment to start
        setTimeout(() => {
            if (runningStudios.has(id)) {
                return res.json({
                    status: true,
                    message: 'Drizzle Studio launched successfully!',
                    port: port,
                    url: `http://localhost:${port}`
                });
            } else {
                return res.json({
                    status: false,
                    message: 'Failed to launch Drizzle Studio'
                });
            }
        }, 2000);

    } catch (error) {
        console.error('-> Error launching studio:', error);
        return res.status(500).json({ 
            status: false, 
            message: 'Internal Server Error while launching Drizzle Studio' 
        });
    }
});

router.post('/stop/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id) {
        return res.json({ status: false, message: 'Bad Request: Missing Parameter ID' });
    }

    if (!runningStudios.has(id)) {
        return res.json({ status: false, message: 'No studio instance running for this database' });
    }

    try {
        const studio = runningStudios.get(id);
        
        // Kill the process
        if (studio.process && !studio.process.killed) {
            studio.process.kill('SIGTERM');
        }
        
        // Cleanup
        runningStudios.delete(id);
        cleanupDrizzleConfig(studio.configPath);
        
        return res.json({
            status: true,
            message: 'Drizzle Studio stopped successfully!'
        });
    } catch (error) {
        console.error('-> Error stopping studio:', error);
        return res.status(500).json({ 
            status: false, 
            message: 'Internal Server Error while stopping Drizzle Studio' 
        });
    }
});

router.get('/status', (req, res) => {
    const studios = Array.from(runningStudios.entries()).map(([id, studio]) => ({
        id,
        port: studio.port,
        url: `http://localhost:${studio.port}`
    }));

    return res.json({
        status: true,
        data: studios
    });
});

function findAvailablePort() {
    const usedPorts = Array.from(runningStudios.values()).map(studio => studio.port);
    let port = 4000;
    
    while (usedPorts.includes(port)) {
        port++;
    }
    
    return port;
}

function createDrizzleConfig(id, dbConfig) {
    const configPath = path.join(__dirname, `../../../drizzle.config.js`);
    console.log(`Creating Drizzle config at: ${configPath}`);
    
    const configContent = `
const { defineConfig } = require('drizzle-kit');

module.exports = defineConfig({
    dialect: '${dbConfig.dialect}',
    dbCredentials: {
        host: '${dbConfig.dbCredentials.hostname}',
        port: ${dbConfig.dbCredentials.port},
        user: '${dbConfig.dbCredentials.username}',
        password: '${dbConfig.dbCredentials.password}',
        database: '${dbConfig.dbCredentials.database}',
    },
    verbose: true,
    strict: true,
});
`;
    
    fs.writeFileSync(configPath, configContent);
    return configPath;
}

function cleanupDrizzleConfig(configPath) {
    try {
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
    } catch (error) {
        console.error('Error cleaning up drizzle config:', error);
    }
}

// Cleanup on process exit
process.on('exit', () => {
    for (const [id, studio] of runningStudios.entries()) {
        if (studio.process && !studio.process.killed) {
            studio.process.kill('SIGTERM');
        }
        cleanupDrizzleConfig(studio.configPath);
    }
});

process.on('SIGINT', () => {
    console.log('Shutting down studio processes...');
    for (const [id, studio] of runningStudios.entries()) {
        if (studio.process && !studio.process.killed) {
            studio.process.kill('SIGTERM');
        }
        cleanupDrizzleConfig(studio.configPath);
    }
    process.exit(0);
});

module.exports = router;
