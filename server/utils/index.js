
import Searcher from "../ip2region.js";
import cookie from "cookie";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import useragent from "useragent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const regineDBPath = path.join(__dirname, "../ip2region.xdb");
const vectorIndex = Searcher.loadVectorIndexFromFile(regineDBPath);
const searcher = Searcher.newWithVectorIndex(regineDBPath, vectorIndex);

const normalizeIp = (ip) => {
  if (!ip) {
      return 'unknown ip';
  }
  if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
  }
  if(ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
};


  const getRequestInfo = async (req, res) => {
    const requestTime = new Date().toISOString();
    let ipAddress = req.clientIp || req.ip;
    if (!ipAddress) {
      if (req.headers["x-forwarded-for"]) {
        ipAddress = req.headers["x-forwarded-for"].split(",")[0];
      } else if (req.headers["x-real-ip"]) {
        ipAddress = req.headers["x-real-ip"];
      } else if (req.connection.remoteAddress) {
        ipAddress = req.connection.remoteAddress;
      }
    }
    const userIp = normalizeIp(ipAddress);
    const requestMethod = req.method;
    const requestUrl = decodeURIComponent(req.originalUrl);
    const requestBody = decodeURIComponent(JSON.stringify(req.body));
    const status = res?.statusCode;
    const cookies = cookie.parse(req.headers.cookie || "");
  
    let region = "";
    try {
      region = (await searcher.search(userIp))?.region || "unknown";
    } catch (e) {
      console.error("获取ip属地出错: ", e);
    }
  
    const userAgentString = req.headers["user-agent"];
    const userAgent = useragent.parse(userAgentString);
  
    const deviceInfo = {
      device: userAgent.device.toString(),
      os: userAgent.os.toString(),
      browser: userAgent.toAgent(),
    };
  
    const data = {
      requestTime,
      userIp,
      requestMethod,
      requestUrl,
      requestBody,
      status,
      userAgent: userAgentString,
      region,
      device: deviceInfo.device,
      os: deviceInfo.os,
      browser: deviceInfo.browser,
      timestamp: new Date().toISOString(),

      cookies
    };
  
    return data;
  };

  
  export {
    normalizeIp,
    getRequestInfo
  }