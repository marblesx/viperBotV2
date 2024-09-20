const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { readFileSync } = require('fs');
const { join } = require('path');


const auth = JSON.parse(readFileSync(join(__dirname, '../auth.json')));
const clientId = auth.clientId;
const guildId = auth.guildId;
const token = auth.token;


const commands = [
    {
        name: 'roll',
        description: 'Roll dice in the format NdM (e.g., 3d6)',
        options: [
            {
                type: 4, // Integer type
                name: 'dice',
                description: 'Number of dice to roll',
                required: true
            },
            {
                type: 4, // Integer type
                name: 'sides',
                description: 'Number of sides on each die',
                required: true
            }
        ]
    },
    {
        name: 'play',
        description: 'Play rock-paper-scissors',
        options: [
            {
                type: 3, // String type
                name: 'choice',
                description: 'Your choice: rock, paper, or scissors',
                required: true,
                choices: [
                    { name: 'Rock', value: 'rock' },
                    { name: 'Paper', value: 'paper' },
                    { name: 'Scissors', value: 'scissors' }
                ]
            }
        ]
    },
    {
        name: '8ball',
        description: 'Ask the magic 8 ball a question',
        options: [
            {
                type: 3, // String type
                name: 'question',
                description: 'Your question for the 8 ball',
                required: true
            }
        ]
    },
    {
        name: 'dndMonsters',
        description: 'Sends back a random monster!'
    }
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
