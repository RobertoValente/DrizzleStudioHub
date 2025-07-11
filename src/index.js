require('dotenv').config(); //-> Migrate to https://dotenvx.com

const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/databases', require('./routes/api/databases.js'));
app.use('/api/studio', require('./routes/api/studio.js'));
app.use('/', require('./routes/root.js'));

app.listen(3000, () => console.log('Server is Running! http://localhost:3000'));