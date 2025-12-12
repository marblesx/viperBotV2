import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { join } from 'path';

type Auth = { token: string };

let auth: Auth;
try {
  auth = JSON.parse(readFileSync(join(process.cwd(), 'auth.json'), 'utf8')) as Auth;
} catch (e) {
  auth = JSON.parse(readFileSync(join(process.cwd(), '..', 'auth.json'), 'utf8')) as Auth;
}

const token = auth.token;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const eightballPhrases = [
  'As I see it, yes.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  'Don’t count on it.',
  'It is certain.',
  'It is decidedly so.',
  'Most likely.',
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Outlook good.',
  'Reply hazy, try again.',
  'Signs point to yes.',
  'Very doubtful.',
  'Without a doubt.',
  'Yes.',
  'Yes – definitely.',
  'You may rely on it.',
];

client.once(Events.ClientReady, () => {
  if (client.user) console.log(`Logged in as ${client.user.tag}!`);
});

client.on(Events.InteractionCreate, async (interaction: any) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'roll') {
    const numDice = options.getInteger('dice');
    const numSides = options.getInteger('sides');

    if (numDice <= 0 || numSides <= 0) {
      await interaction.reply('Please provide valid numbers for the number of dice and the number of sides.');
      return;
    }

    const results: number[] = [];
    let total = 0;

    for (let i = 0; i < numDice; i++) {
      const roll = Math.floor(Math.random() * numSides) + 1;
      results.push(roll);
      total += roll;
    }

    const resultStr = results.join(', ');
    await interaction.reply(`Rolling ${numDice} d${numSides}... Results: ${resultStr}. Total: ${total}`);
  } else if (commandName === 'play') {
    const userChoice = options.getString('choice');
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    let result: string;

    if (userChoice === botChoice) {
      result = "It's a tie!";
    } else if (
      (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper')
    ) {
      result = 'You win!';
    } else {
      result = 'You lose!';
    }

    await interaction.reply(`Rock, paper, scissors, shoot! You chose **${userChoice}**. I chose **${botChoice}**. ${result}`);
  } else if (commandName === '8ball') {
    const question = options.getString('question');

    if (!question) {
      await interaction.reply('Please ask a question.');
      return;
    }

    await interaction.reply(
      `🎱 Question: ${question}\nAnswer: ${eightballPhrases[Math.floor(Math.random() * eightballPhrases.length)]}`
    );
  } else if (commandName === 'dnd_monster') {
    const monsterResponse = await fetch('https://www.dnd5eapi.co/api/monsters');
    if (!monsterResponse.ok) {
      return interaction.reply('Monster hunter is down.');
    }
    const data = (await monsterResponse.json()) as {
      count: number;
      results: { index: string; name: string; url: string }[];
    };

    const monster = data.results[Math.floor(Math.random() * data.count)];
    const monsterDataResponse = await fetch(`https://www.dnd5eapi.co${monster.url}`);
    if (!monsterDataResponse.ok) {
      return interaction.reply('Monster hunter is down.');
    }

    const monsterData = (await monsterDataResponse.json()) as {
      name: string;
      size: string;
      type: string;
      alignment: string;
      armor_class: { value: number }[];
      hit_points: number;
      image?: string;
    };
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(monsterData.name)
      .setDescription(`*${monsterData.size} ${monsterData.type} (${monsterData.alignment})*`)
      .addFields(
        { name: 'Armor Class', value: monsterData.armor_class[0].value.toString(), inline: true },
        { name: 'Hit Points', value: monsterData.hit_points.toString(), inline: true }
      )
      .setImage(`https://www.dnd5eapi.com${monsterData.image}`)
      .setURL(`https://www.dnd5eapi.com${monster.url}`)
      .setFooter({ text: 'More Info' });

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(token);
