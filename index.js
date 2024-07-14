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

    try{

    var result;
    var statusCode; 

    const userId = req.body.userId;
    const code = req.body.code;
    const lang = req.body.lang;
    const input = req.body.input;

    const folderPath = path.join(__dirname, `./${lang}/run/`);

    if(checkPath(folderPath+`${userId}`)){
        await deleteFolder(folderPath+`${userId}`);
    }

    await createFolder(folderPath+`${userId}`);

    await createFolder(folderPath+`${userId}/inputs`);

    await createFile(folderPath+`${userId}/main${getCodeExtension(lang)}`,code);

    await createFile(folderPath+`${userId}/inputs/input.in`,input);

    const codePath = `${lang}/run/${userId}/`;
    {
        const { stdout, stderr } = await exec(`g++ -o ${codePath}myapp ${codePath}main${getCodeExtension(lang)}; echo $?`);

        [result, statusCode] = await getCode(stdout);

        if(statusCode == "1"){
            await sendResp(res,stderr,"CMP_ERR",200);
            if(checkPath(folderPath+`${userId}`)){
                await deleteFolder(folderPath+`${userId}`);
            }
            return;
        }
    }

    {
        const { stdout, stderr } = (await exec(`timeout 2 ${codePath}myapp < ${codePath}inputs/input.in; echo $?`));

        [result, statusCode] = await getCode(stdout);

        if(statusCode == "136"){
            await sendResp(res,stderr,"RUN_ERR",200);
        }else if(statusCode == "124"){
            await sendResp(res,"Time Limit Exceeded","TLE_ERR",200);
        }else{
            await sendResp(res,result,"OK",200);
        }
    }

    if(checkPath(folderPath+`${userId}`)){
        await deleteFolder(folderPath+`${userId}`);
    }

    }catch(err){
        sendResp(res,err.message,"INTERNAL_ERR",500);
    }
})

app.post('/submitCode',async (req,res)=>{

    try{

    const userId = req.body.userId;
    const code = req.body.code;
    const lang = req.body.lang;
    const problemId = req.body.problemId;
    const ssid = req.body.ssid;
    const csrf = req.body.csrf;

    if(ssid==null || csrf==null){
        await sendResp(res,"SSID or CSRF cannot be null","INVALID_REQ",200);
        return;
    }

    const folderPath = path.join(__dirname, `./${lang}/submit/`);

    if(checkPath(folderPath+`${userId}`)){
        await deleteFolder(folderPath+`${userId}`);
    }

    await createFolder(folderPath+`${userId}`);

    await createFolder(folderPath+`${userId}/inputs`);

    await createFolder(folderPath+`${userId}/outputs`);

    await createFolder(folderPath+`${userId}/tests`);

    await createFile(folderPath+`${userId}/main${getCodeExtension(lang)}`,code);

    {
        const {stdout,stderr} = await exec(`g++ -o ${lang}/submit/${userId}/myapp ${lang}/submit/${userId}/main.cpp; echo $?`);

        [result, statusCode] = await getCode(stdout);

        if(statusCode == "1"){
            await sendResp(res,stderr,"CMP_ERR",200);
            if(checkPath(folderPath+`${userId}`)){
                await deleteFolder(folderPath+`${userId}`);
            }
            return;
        }
    }

    const len = await addTestCase(problemId,ssid,csrf,folderPath+`${userId}`);

    for(var i=1;i<=len;i++){
        await removeTrailingSpaces(folderPath+`${userId}/outputs/${i}.out`);
    }

    {
        for(var idx=1;idx<=len;idx++){

            const {stdout,stderr} = await exec(`timeout 1 ${lang}/submit/${userId}/myapp <${lang}/submit/${userId}/inputs/${idx}.in> ${lang}/submit/${userId}/tests/${idx}.out; echo $?`);

            [result, statusCode] = await getCode(stdout);

            if(statusCode == "124"){
                await sendResp(res,"Time Limit Exceeded at Testcase : "+idx,"TLE_ERR",200);
                await deleteFolder(folderPath+`${userId}`);
                return;
            }else if(statusCode == "136"){
                await sendResp(res,`Runtime Error at Testcase : ${idx}.\n Message : ${stderr}`,"RUN_ERR",200);
                await deleteFolder(folderPath+`${userId}`);
                return;
            }

            await removeTrailingSpaces(`${lang}/submit/${userId}/tests/${idx}.out`);

            {
            const {stdout,stderr} = await exec(`cmp ${lang}/submit/${userId}/tests/${idx}.out ${lang}/submit/${userId}/outputs/${idx}.out; echo $?`);

            [result, statusCode] = await getCode(stdout);

                if(statusCode == "1"){
                    await sendResp(res,`Worng Output at Testcase : ${idx}`,"WA_ERR",200);
                    await deleteFolder(folderPath+`${userId}`);
                    return;
                }
            }

        }
    }

    await deleteFolder(folderPath+`${userId}`);
    await sendResp(res,"ACCEPTED","AC",200);

    }catch(err){
        sendResp(res,err.message,"INTERNAL_ERR",500);
    }

})

const checkPath = async (a)=>{

    var result, statusCode;
    const { stdout, stderr } = await exec(`ls ${a}; echo $?`);
    [result, statusCode] = await getCode(stdout);

    if(statusCode == 0 || statusCode=="0"){
        return true;
    }
    return false;
}

const getCode = (msg)=>{
    return new Promise((resolve)=>{
        var code="";
        var res="";
        var x = msg.length-2,y=0;
        while(x>=0 && msg[x]!='\n'){
            code = msg[x]+code;
            x--;
        }
        while(y<=x){
            res+=msg[y];
            y++;
        }
        resolve([res,code]);
    })
}

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
        output:message,
        code:status
    }
    await resp.status(code).send(data);
}

const addTestCase = (problem,ssid,csrf,folderPath)=>{

    return new Promise(async (resolve,reject)=>{

        var len = 0;

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

