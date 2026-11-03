#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),root=path.resolve(__dirname,"..");
const files=fs.readdirSync(root).filter(f=>f.endsWith(".gs")).sort(),seen=new Map();
if(!files.length)throw Error("No Apps Script files");
for(const file of files){const s=fs.readFileSync(path.join(root,file),"utf8"),r=/^function\s+([\w$]+)\s*\(/gm;let m;while((m=r.exec(s))){if(seen.has(m[1]))throw Error("Duplicate "+m[1]+" in "+seen.get(m[1])+" and "+file);seen.set(m[1],file);}}
new vm.Script(files.map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n"));
JSON.parse(fs.readFileSync(path.join(root,"appsscript.json"),"utf8"));
console.log("PHIS syntax OK: "+files.length+" modules, "+seen.size+" unique functions.");
