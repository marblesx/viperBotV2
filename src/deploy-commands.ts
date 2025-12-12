import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { readFileSync } from 'fs';
import { join } from 'path';

type Auth = { clientId: string; guildId: string; token: string };

let auth: Auth;
try {
  auth = JSON.parse(readFileSync(join(process.cwd(), 'auth.json'), 'utf8')) as Auth;
} catch (e) {
  auth = JSON.parse(readFileSync(join(process.cwd(), '..', 'auth.json'), 'utf8')) as Auth;
}

const clientId = auth.clientId;
const guildId = auth.guildId;
const token = auth.token;

const commands: any[] = [
  {
    name: 'roll',
    description: 'Roll dice in the format NdM (e.g., 3d6)',
    options: [
      {
        type: 4,
        name: 'dice',
        description: 'Number of dice to roll',
        required: true,
      },
      {
        type: 4,
        name: 'sides',
        description: 'Number of sides on each die',
        required: true,
      },
    ],
  },
  {
    name: 'play',
    description: 'Play rock-paper-scissors',
    options: [
      {
        type: 3,
        name: 'choice',
        description: 'Your choice: rock, paper, or scissors',
        required: true,
        choices: [
          { name: 'Rock', value: 'rock' },
          { name: 'Paper', value: 'paper' },
          { name: 'Scissors', value: 'scissors' },
        ],
      },
    ],
  },
  {
    name: '8ball',
    description: 'Ask the magic 8 ball a question',
    options: [
      {
        type: 3,
        name: 'question',
        description: 'Your question for the 8 ball',
        required: true,
      },
    ],
  },
  {
    name: 'dnd_monster',
    description: 'Sends back a random monster!',
    options: [],
  },
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
