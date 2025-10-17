import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { fileURLToPath } from 'url';

function formatToISO(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

async function delayTime(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(token, chatId, message) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const data = { chat_id: chatId, text: message };
    try {
        await axios.post(url, data);
        console.log('消息已发送到 Telegram');
    } catch (error) {
        console.error('发送 Telegram 消息时出错:', error.message);
    }
}

async function fillLoginForm(page, username, password) {
    // 尝试多个选择器来找到用户名输入框
    const usernameSelectors = [
        '#id_username',
        '#id_login',
        'input[name="login"]',
        'input[name="username"]',
        'input[type="text"]',
    ];

    let usernameInput = null;
    for (const selector of usernameSelectors) {
        usernameInput = await page.$(selector);
        if (usernameInput) {
            console.log(`找到用户名输入框: ${selector}`);
            break;
        }
    }

    if (!usernameInput) {
        throw new Error('无法找到用户名输入框');
    }

    // 尝试多个选择器来找到密码输入框
    const passwordSelectors = [
        '#id_password',
        'input[name="password"]',
        'input[type="password"]',
    ];

    let passwordInput = null;
    for (const selector of passwordSelectors) {
        passwordInput = await page.$(selector);
        if (passwordInput) {
            console.log(`找到密码输入框: ${selector}`);
            break;
        }
    }

    if (!passwordInput) {
        throw new Error('无法找到密码输入框');
    }

    // 清空并填充用户名
    await usernameInput.click({ clickCount: 3 });
    await usernameInput.press('Backspace');
    await page.type(await page.evaluate(el => el.getAttribute('name') ? `input[name="${el.getAttribute('name')}"]` : '#id_username', usernameInput), username);

    // 直接在输入框中输入
    await usernameInput.type(username);
    await delayTime(300);

    // 填充密码
    await passwordInput.type(password);
    await delayTime(300);
}

async function findAndClickLoginButton(page) {
    // 尝试多个选择器来找到登录按钮
    const buttonSelectors = [
        '#submit',
        'button[type="submit"]',
        'button:has-text("Zaloguj")',
        'button:has-text("Login")',
        'button:nth-child(1)',
    ];

    for (const selector of buttonSelectors) {
        try {
            const button = await page.$(selector);
            if (button) {
                console.log(`找到登录按钮: ${selector}`);
                await button.click();
                return true;
            }
        } catch (e) {
            // 继续尝试下一个选择器
        }
    }

    // 如果上述都失败，尝试通过XPath
    try {
        const button = await page.$x('//button[contains(., "Zaloguj") or contains(., "Login")]');
        if (button.length > 0) {
            console.log('通过XPath找到登录按钮');
            await button[0].click();
            return true;
        }
    } catch (e) {
        // 继续
    }

    throw new Error('无法找到登录按钮');
}

async function checkLoginSuccess(page) {
    // 方法1: 检查是否存在登出链接
    const hasLogoutLink = await page.evaluate(() => {
        return document.querySelector('a[href="/logout/"]') !== null;
    });

    if (hasLogoutLink) {
        return true;
    }

    // 方法2: 检查URL是否改变（不在登录页面）
    const currentUrl = page.url();
    if (!currentUrl.includes('login')) {
        return true;
    }

    // 方法3: 检查是否存在错误消息
    const hasError = await page.evaluate(() => {
        const errorElements = document.querySelectorAll('.error, .alert-danger, [class*="error"], [class*="fail"]');
        return errorElements.length > 0;
    });

    return !hasError;
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const panelBaseUrl = "panel";
    const defaultDomain = "serv00.com";

    const loginResults = [];

    for (const account of accounts) {
        const { username, password, panelnum, domain } = account;

        let panel;
        if (domain === "ct8.pl") {
            panel = `panel.${domain}`;
        } else {
            panel = `${panelBaseUrl}${panelnum}.${domain || defaultDomain}`;
        }

        const url = `https://${panel}/login/?next=/`;
        console.log(`\n尝试登录账号 ${username}，地址: ${url}`);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'networkidle2' });
            await delayTime(1000); // 等待页面完全加载

            // 填充登录表单
            await fillLoginForm(page, username, password);

            // 点击登录按钮
            await findAndClickLoginButton(page);

            // 等待页面导航或加载
            try {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
            } catch (e) {
                console.log('页面导航超时，继续检查登录状态...');
                await delayTime(2000);
            }

            // 检查是否登录成功
            const isLoggedIn = await checkLoginSuccess(page);

            const nowUtc = formatToISO(new Date());
            const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));

            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            const status = isLoggedIn ? "登录成功" : "登录失败";

            loginResults.push(`账号（${username}）（${serverName}）${status}`);

            console.log(`账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）${status}`);
        } catch (error) {
            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            loginResults.push(`账号（${username}）（${serverName}）登录时出现错误: ${error.message}`);
            console.error(`账号 ${username} 登录时出现错误: ${error.message}`);
        } finally {
            await page.close();
            await browser.close();
            const delay = Math.floor(Math.random() * 5000) + 1000;
            await delayTime(delay);
        }
    }

    // 汇总并发送报告
    const reportTitle = "ct8&serv00登陆报告：";
    const reportContent = loginResults.join('\n');
    const finalReport = `${reportTitle}\n${reportContent}`;

    console.log('\n' + finalReport);

    if (telegramToken && telegramChatId) {
        await sendTelegramMessage(telegramToken, telegramChatId, finalReport);
    }

    console.log('\n所有账号登录完成！');
})();
