const express = require("express");
const {json, urlencoded} = require("express");
const { default: axios } = require("axios");
const unzipper = require('unzipper');
const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const readline = require('readline');

const app = express();

const url = "https://cses.fi";

app.use(json());
app.use(urlencoded({ extended: true }));

app.post('/runCode',async (req,res)=>{

    var result = '';

    const userId = req.body.userId;
    const code = req.body.code;
    const lang = req.body.lang;
    const input = req.body.input;

    console.log(__dirname);

    const folderPath = path.join(__dirname, `./${lang}/run/`);

    await deleteFolder(folderPath+`${userId}`);

    await createFolder(folderPath+`${userId}`);

    await createFolder(folderPath+`${userId}/inputs`);

    await createFile(folderPath+`${userId}/main${getCodeExtension(lang)}`,code);

    await createFile(folderPath+`${userId}/inputs/input.in`,input);

    const codePath = `${lang}/run/${userId}/`;

    try{
        await exec(`g++ -o ${codePath}myapp ${codePath}main${getCodeExtension(lang)}`);
    }catch(err){
        console.log("error during compilation");
        await deleteFolder(folderPath+`${userId}`);
        sendResp(res,err.stderr,"ok",200);
        return;
    }

    try{
        result = (await exec(`${codePath}myapp <${codePath}inputs/input.in`)).stdout;
    }catch(err){
        console.log("error during runtime");
        await deleteFolder(folderPath+`${userId}`);
        sendResp(res,err.stderr,"ok",200);
        return;
    }

    await deleteFolder(folderPath+`${userId}`);
    await sendResp(res,result,"ok",200);

})

app.post('/submitCode',async (req,res)=>{

    const userId = req.body.userId;
    const code = req.body.code;
    const lang = req.body.lang;
    const problemId = req.body.problemId;
    const ssid = req.body.ssid;
    const csrf = req.body.csrf;

    const folderPath = path.join(__dirname, `./${lang}/submit/`);

    await deleteFolder(folderPath+`${userId}`);

    await createFolder(folderPath+`${userId}`);

    await createFolder(folderPath+`${userId}/inputs`);

    await createFolder(folderPath+`${userId}/outputs`);

    await createFolder(folderPath+`${userId}/tests`);

    await createFile(folderPath+`${userId}/main${getCodeExtension(lang)}`,code);

    try{
        await exec(`g++ -o ${lang}/submit/${userId}/myapp ${lang}/submit/${userId}/main.cpp`);
    }catch(err){
        console.log("error during compilation");
        await deleteFolder(folderPath+`${userId}`);
        sendResp(res,err.stderr,"ok",200);
        return;
    }

    const len = await addTestCase(problemId,ssid,csrf,folderPath+`${userId}`);

    for(var i=1;i<=len;i++){
        await removeTrailingSpaces(folderPath+`${userId}/outputs/${i}.out`);
    }

    try{
        for(var idx=1;idx<=len;idx++){
            await exec(`${lang}/submit/${userId}/myapp <${lang}/submit/${userId}/inputs/${idx}.in> ${lang}/submit/${userId}/tests/${idx}.out`);
            console.log("TestCase "+idx);
            await removeTrailingSpaces(`${lang}/submit/${userId}/tests/${idx}.out`);
            await exec(`cmp ${lang}/submit/${userId}/tests/${idx}.out ${lang}/submit/${userId}/outputs/${idx}.out`);
        }
    }catch(err){
        console.log("error during runtime : ",err);
        await deleteFolder(folderPath+`${userId}`);
        sendResp(res,err,"ok",200);
        return;
    }

    await deleteFolder(folderPath+`${userId}`);
    await sendResp(res,"ACCEPTED","OK",200);
})

const deleteFolder = (path)=>{
    return new Promise((resolve,reject)=>{
        fs.remove(path,(err)=>{
            if(err){
                console.log(`error during removing folder  at ${path} : `,err);
                reject(err);
            }else{
                resolve();
            }
        });
    })
}

const createFolder = (path)=>{
    return new Promise((resolve,reject)=>{
        fs.mkdir(path,(err)=>{
            if(err){
                console.log(`error during creating folder  at ${path} : `,err);
                reject(err);
            }else{
                resolve();
            }
        });
    })
}

const createFile = (path,value)=>{
    return new Promise((resolve,reject)=>{
        fs.writeFile(path,value,(err)=>{
            if(err){
                console.log(`error during creating file  at ${path} : `,err);
                reject(err);
            }else{
                resolve();
            }
        })
    })
}

const getCodeExtension = (lang)=>{
    switch(lang){
        case "CPP":
        case "C":
            return ".cpp";
        case "JAVA":
            return ".java";
        case "PYTHON":
            return ".py";
        default:
            return ".txt";
    }
}

const sendResp = async (resp, message,status,code)=>{
    const data = {
        message:message,
        status:status
    }
    await resp.status(code).send(data);
}

const addTestCase = (problem,ssid,csrf,folderPath)=>{

    return new Promise(async (resolve,reject)=>{

        var len = 0;

        console.log("SSID : "+ssid,"CSRF : "+csrf);

        const response = await axios({
            method: 'post',
            url: url+'/problemset/tests/' + problem,
            responseType: 'stream',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': `PHPSESSID=${ssid}`
            },
            data: {
                csrf_token: `${csrf}`,
                download: "true",
            }
        })

        await response.data.pipe(unzipper.Parse()).on('entry', entry => {

        const fileName = entry.path;
        const type = entry.type;
        
        if (type === 'File') {
            
            if (fileName.endsWith('.in')) {
                len++;
                entry.pipe(fs.createWriteStream(folderPath+'/inputs/'+entry.path));
            } else if (fileName.endsWith('.out')) {
                entry.pipe(fs.createWriteStream(folderPath+'/outputs/'+entry.path));
            }
        } else {
            entry.autodrain();
        }
    }).on('close', async () => {
        resolve(len);
    });
    
    })
}

const removeTrailingSpaces = (filePath) => {

    const tempFilePath = filePath + '.tmp';

    return new Promise((resolve, reject) => {
        const inputStream = fs.createReadStream(filePath);
        const outputStream = fs.createWriteStream(tempFilePath);

        const rl = readline.createInterface({
            input: inputStream,
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            outputStream.write(line.trimEnd() + '\n');
        });

        rl.on('close', () => {
            outputStream.end(() => {
                // Replace the original file with the temporary file
                fs.rename(tempFilePath, filePath, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });
    });
}

app.listen(3000,()=>{
    console.log("CODE RUNNER IS RUNNING at 3000");
})

