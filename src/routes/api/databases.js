const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

router.get('/', (req, res) => {
    const databases = getDatabases();

    return res.json({
        status: true,
        data: databases
    });
});

router.get('/:id', (req, res) => {
    const { id } = req.params;
    if (!id) return res.json({ status: false, message: 'Bad Request: Missing Parameter ID' });

    const databases = getDatabases();
    const database = databases.find(db => db.name === id + '.json');

    return res.json({ status: true, data: database || null });
});

router.post('/', (req, res) => {
    const { dialect, username, password, hostname, database, port } = req.body;

    if (!dialect || !username || !password || !hostname || !database || !port) return res.json({ status: false, message: 'Bad Request: Missing required fields' });
    if(dialect !== 'mysql') return res.json({ status: false, message: 'Bad Request: Unsupported dialect' });

    try {
        const dataPath = path.join(__dirname, '../../data');
        const filePath = path.join(dataPath, `${crypto.randomUUID()}.json`);

        fs.writeFileSync(filePath, JSON.stringify({
            dialect,
            dbCredentials: {
                username,
                password,
                hostname,
                database,
                port,
            }
        }, null, 4));
    } catch (error) {
        console.error('-> Error:', error);
        return res.status(500).json({ status: false, message: 'Internal Server Error while saving database configuration!' });
    }

    return res.json({ status: true, message: 'Database configuration saved successfully!' });
});

router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { dialect, username, password, hostname, database, port } = req.body;

    if (!id || !dialect || !username || !password || !hostname || !database || !port) return res.json({ status: false, message: 'Bad Request: Missing required fields' });
    if (dialect !== 'mysql') return res.json({ status: false, message: 'Bad Request: Unsupported dialect' });

    try {
        const dataPath = path.join(__dirname, '../../data');
        const filePath = path.join(dataPath, `${id}.json`);
        if (!fs.existsSync(filePath)) return res.json({ status: false, message: 'Not Found: Database configuration does not exist' });

        fs.writeFileSync(filePath, JSON.stringify({
            dialect,
            dbCredentials: {
                username,
                password,
                hostname,
                database,
                port,
            }
        }, null, 4));
    } catch (error) {
        console.error('-> Error:', error);
        return res.status(500).json({ status: false, message: 'Internal Server Error while updating database configuration!' });
    }

    return res.json({ status: true, message: 'Database configuration updated successfully!' });
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;

    if (!id) return res.json({ status: false, message: 'Bad Request: Missing Parameter ID' });

    const dataPath = path.join(__dirname, '../../data');
    const filePath = path.join(dataPath, `${id}.json`);
    if (!fs.existsSync(filePath)) return res.json({ status: false, message: 'Not Found: Database configuration does not exist' });

    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('-> Error:', error);
        return res.status(500).json({ status: false, message: 'Internal Server Error while deleting database configuration!' });
    }

    return res.json({ status: true, message: `Database configuration with ID ${id} deleted successfully!` });
});

function getDatabases() {
    const dataPath = path.join(__dirname, '../../data');
    let files = fs.readdirSync(dataPath);
    files = files.filter(file => file.endsWith('.json') && file !== 'example_data.json');
    
    return files.map(file => {
        const filePath = path.join(dataPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        return {
            name: file,
            content: JSON.parse(content),
        };
    });
}

module.exports = router;