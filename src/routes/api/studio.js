const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

let currentStudio = null;

router.post('/launch/:id', async (req, res) => {
    const { id } = req.params;
    
    if (!id) {
        return res.json({ status: false, message: 'Bad Request: Missing Parameter ID' });
    }

    if (currentStudio) {
        return res.json({ 
            status: false, 
            message: `Another Drizzle Studio is already running for database "${currentStudio.databaseId}". Stop it first to launch a new one.`,
            runningDatabase: currentStudio.databaseId
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
        const port = 4983;
        
        const portInUse = await isPortInUse(port);
        if (portInUse) {
            console.log(`Port ${port} is already in use, attempting to find and kill existing process...`);
            
            try {
                await new Promise((resolve, reject) => {
                    exec(`lsof -ti :${port}`, (error, stdout, stderr) => {
                        if (error) {
                            console.log('No process found using the port');
                            resolve();
                            return;
                        }
                        
                        const pid = stdout.trim();
                        if (pid) {
                            console.log(`Killing process ${pid} that was using port ${port}`);
                            exec(`kill -9 ${pid}`, (killError) => {
                                if (killError) {
                                    console.error('Error killing process:', killError);
                                    reject(killError);
                                } else {
                                    console.log(`Successfully killed process ${pid}`);
                                    resolve();
                                }
                            });
                        } else {
                            resolve();
                        }
                    });
                });
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error('Error handling port cleanup:', error);
                return res.json({ 
                    status: false, 
                    message: `Port ${port} is already in use and could not be freed. Please try again.` 
                });
            }
        }
        
        const drizzleConfigPath = createDrizzleConfig(id, config);
        const studioProcess = spawn('npx', ['drizzle-kit', 'studio', '--config', drizzleConfigPath, '--port', port.toString()], {
            cwd: path.join(__dirname, '../..'),
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        studioProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            //console.log(`Studio stdout: ${data}`);
        });

        studioProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            //console.log(`Studio stderr: ${data}`);
        });

        // Store the process
        currentStudio = {
            databaseId: id,
            process: studioProcess,
            port: port,
            configPath: drizzleConfigPath
        };

        // Handle process events
        studioProcess.on('error', (error) => {
            //console.error(`Studio process error for ${id}:`, error);
            //console.error(`Stdout: ${stdout}`);
            //console.error(`Stderr: ${stderr}`);
            currentStudio = null;
            cleanupDrizzleConfig(drizzleConfigPath);
        });

        studioProcess.on('exit', (code) => {
            console.log(`Studio process for ${id} exited with code ${code}`);
            if (code !== 0) {
                console.error(`Stdout: ${stdout}`);
                console.error(`Stderr: ${stderr}`);
            }
            currentStudio = null;
            cleanupDrizzleConfig(drizzleConfigPath);
        });

        setTimeout(async () => {
            if (currentStudio && currentStudio.databaseId === id) {
                const isRunning = await isPortInUse(port);
                
                if (isRunning) {
                    return res.json({
                        status: true,
                        message: 'Drizzle Studio launched successfully!',
                        port: port,
                        url: `https://local.drizzle.studio`
                    });
                } else {
                    currentStudio = null;
                    cleanupDrizzleConfig(drizzleConfigPath);
                    return res.json({
                        status: false,
                        message: 'Failed to launch Drizzle Studio - process started but port not accessible'
                    });
                }
            } else {
                return res.json({
                    status: false,
                    message: 'Failed to launch Drizzle Studio - process exited'
                });
            }
        }, 5000);

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

    if (!currentStudio || currentStudio.databaseId !== id) {
        return res.json({ status: false, message: 'No studio instance running for this database' });
    }

    try {
        if (currentStudio.process && !currentStudio.process.killed && currentStudio.process.pid) {
            console.log(`Stopping studio process for ${id} (PID: ${currentStudio.process.pid})`);
            killProcessTree(currentStudio.process.pid);
        }
        
        exec(`lsof -ti :${currentStudio.port}`, (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
                const pids = stdout.trim().split('\n');
                pids.forEach(pid => {
                    try {
                        process.kill(pid, 'SIGTERM');
                        console.log(`Killed process ${pid} using port ${currentStudio.port}`);
                        
                        setTimeout(() => {
                            try {
                                process.kill(pid, 'SIGKILL');
                            } catch (e) {
                                // Process already dead
                            }
                        }, 2000);
                    } catch (err) {
                        console.log(`Process ${pid} already dead`);
                    }
                });
            }
        });
        
        const configPath = currentStudio.configPath;
        currentStudio = null;
        cleanupDrizzleConfig(configPath);
        
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

router.post('/stop', (req, res) => {
    if (!currentStudio) {
        return res.json({ status: false, message: 'No studio instance is currently running' });
    }

    try {
        if (currentStudio.process && !currentStudio.process.killed && currentStudio.process.pid) {
            console.log(`Stopping studio process for ${currentStudio.databaseId} (PID: ${currentStudio.process.pid})`);
            killProcessTree(currentStudio.process.pid);
        }
        
        exec(`lsof -ti :${currentStudio.port}`, (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
                const pids = stdout.trim().split('\n');
                pids.forEach(pid => {
                    try {
                        process.kill(pid, 'SIGTERM');
                        console.log(`Killed process ${pid} using port ${currentStudio.port}`);
                        
                        setTimeout(() => {
                            try {
                                process.kill(pid, 'SIGKILL');
                            } catch (e) {
                                // Process already dead
                            }
                        }, 2000);
                    } catch (err) {
                        console.log(`Process ${pid} already dead`);
                    }
                });
            }
        });
        
        const configPath = currentStudio.configPath;
        const databaseId = currentStudio.databaseId;
        currentStudio = null;
        cleanupDrizzleConfig(configPath);
        
        return res.json({
            status: true,
            message: `Drizzle Studio stopped successfully! (was running for database: ${databaseId})`
        });
    } catch (error) {
        console.error('-> Error stopping studio:', error);
        return res.status(500).json({ 
            status: false, 
            message: 'Internal Server Error while stopping Drizzle Studio' 
        });
    }
});

router.get('/status', async (req, res) => {
    if (!currentStudio) {
        return res.json({
            status: true,
            data: null
        });
    }

    const isRunning = await isPortInUse(currentStudio.port);
    
    if (!isRunning || currentStudio.process.killed) {
        console.log('Studio process detected as not running, cleaning up...');
        if (currentStudio.process && !currentStudio.process.killed) {
            killProcessTree(currentStudio.process.pid);
        }
        cleanupDrizzleConfig(currentStudio.configPath);
        currentStudio = null;
        
        return res.json({
            status: true,
            data: null
        });
    }

    const studio = {
        id: currentStudio.databaseId,
        port: currentStudio.port,
        url: `https://local.drizzle.studio`
    };

    return res.json({
        status: true,
        data: studio
    });
});

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

process.on('exit', () => {
    if (currentStudio) {
        if (currentStudio.process && !currentStudio.process.killed && currentStudio.process.pid) {
            killProcessTree(currentStudio.process.pid);
        }
        cleanupDrizzleConfig(currentStudio.configPath);
    }
});

process.on('SIGINT', () => {
    console.log('Shutting down studio processes...');
    if (currentStudio) {
        if (currentStudio.process && !currentStudio.process.killed && currentStudio.process.pid) {
            killProcessTree(currentStudio.process.pid);
        }
        cleanupDrizzleConfig(currentStudio.configPath);
    }
    process.exit(0);
});

function isPortInUse(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const server = net.createServer();
        
        server.listen(port, () => {
            server.close(() => {
                resolve(false); // Port is free
            });
        });
        
        server.on('error', () => {
            resolve(true); // Port is in use
        });
    });
}

function killProcessTree(pid) {
    try {
        console.log(`Attempting to kill process ${pid} and its children...`);
        
        exec(`pgrep -P ${pid}`, (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
                const childPids = stdout.trim().split('\n');
                console.log(`Found child processes: ${childPids.join(', ')}`);
                
                childPids.forEach(childPid => {
                    try {
                        process.kill(childPid, 'SIGTERM');
                        console.log(`Killed child process ${childPid}`);
                    } catch (err) {
                        console.log(`Child process ${childPid} already dead or not found`);
                    }
                });
                
                setTimeout(() => {
                    childPids.forEach(childPid => {
                        try {
                            process.kill(childPid, 'SIGKILL');
                        } catch (err) {
                            // Process already dead
                        }
                    });
                }, 1000);
            }
        });
        
        try {
            process.kill(pid, 'SIGTERM');
            console.log(`Sent SIGTERM to process ${pid}`);
        } catch (error) {
            console.log(`Process ${pid} already dead or not found`);
        }
        
        setTimeout(() => {
            try {
                process.kill(pid, 'SIGKILL');
                console.log(`Sent SIGKILL to process ${pid}`);
            } catch (error) {
                console.log(`Process ${pid} already terminated`);
            }
        }, 3000);
        
    } catch (error) {
        console.error('Error in killProcessTree:', error);
    }
}

module.exports = router;
