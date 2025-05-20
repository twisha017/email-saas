const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const API_KEY = "AIzaSyCVs2GVPL55Xa6-nABR7PdnWuqPRgp1n8E";
const express = require('express');
const app = express();
const port = 3001;
const schedule = require('node-schedule');

const labelMap = [];
// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send'
];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credential.json');


async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/*Load or request or authorization to call APIs.*/
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}
/* List the labels */
async function listLabels(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.labels.list({
        userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
        console.log('No labels found.');
        return;
    }
    console.log('Labels:');
    labels.forEach((label) => {
        console.log(`${label.name}:${label.id}`);
        labelMap.push({ name: label.name, id: label.id });

    });
    const res1 = await gmail.users.messages.list({
        userId: 'me',
        q : 'is:unread',
        maxResults : 5,

    });
    const messages = res1.data.messages;
    if(messages.length > 0){
    for (let message of messages) {
        const email =  await getEmail(message.id , auth);
        generateEmailLabels(email.data.snippet)
        .then(labels => {
        const labelRegex = /\d\. \*\*(.*?)\*\*/g;
        let match;
        let newlabel = [];
              
        while ((match = labelRegex.exec(labels)) !== null) {
            newlabel.push(match[1]);
        }
        console.log(newlabel);
        //generate new label as per content
        if(newlabel.length > 0){
            for (const labelName of newlabel) {
                if (!labelExists(labelName, labelMap)) {
                    createLabel(auth,labelName)
                }
                moveEmailToLabel(auth, email.data.id,newlabel,email.data.labelIds);

                //const labelId = getLabelId(labelName, labelMap);

              //if (labelId) {
              // Use the label ID to move the email
              //}
        }
    }})
        .catch(error => {
            console.error(error);
        });
    }
}
}
function labelExists(labelName, labelMap) {
    for (const label of labelMap) {
      if (label.name === labelName) {
        return true;
      }
    }
    return false;
  }

  function getLabelId(labelName, labelMap) {
    for (const label of labelMap) {
      if (label.name === labelName) {
        console.log(`label.name : label.id`);
        return [label.id];
      }
    }
    return null; // Label not found
  }

async function moveEmailToLabel(auth, messageId, labelname, removeId) {
    const gmail = google.gmail({ version: 'v1', auth });
  
    try {
      const res = await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabel: labelname,
          removeLabelIds: [removeId] 
        }
      });
  
      console.log('Email moved to label:', res.data);
    } catch (err) {
      console.error('Error moving email:', err);
    }
  }
  
  async function createLabel(auth, labelName) {
    const gmail = google.gmail({ version: 'v1', auth });
    const labelObject = {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
    };

    try {
        const response = await gmail.users.labels.create({
            userId: 'me',
            requestBody: labelObject,
        });
        console.log(`Created label: ${response.data.name}`);
        labelMap.push({ name: response.data.name, id: response.data.id });

    } catch (error) {
        console.error('Error creating label:', error);
    }      
  }

async function generateEmailLabels(emailContent) {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
    const prompt = `Given the following email content, suggest most appropriate any two label name only not description:${emailContent}`;
  
    const response = await model.generateContent([prompt]);
    const labels = response.response.text().split(',').map(label => label.trim());
  
    return labels;
}

async function getEmail(messageId,auth) {
    const gmail1 = google.gmail({version : 'v1',auth});

    const res = await gmail1.users.messages.get({
        'userId': 'me',
        'id': messageId
    });
    return res;

}

// app.get("/", async (req, res) => {
    

//     main().catch(console.error);
//     res.send("Success !!!!");
// })


schedule.scheduleJob('*/50 * * * *', async () => {
  try {
    const auth = await authorize();
    await listLabels(auth);
  } catch (error) {
    console.error('Error:', error);
  }
});

app.listen(port, () => {
    console.log(`Listening at: http://localhost:${port}`);
})