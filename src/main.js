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
    console.log('开始填充登录表单...');
    
    // 尝试多个选择器来找到用户名输入框
    const usernameSelectors = [
        '#id_username',
        '#id_login',
        'input[name="login"]',
        'input[name="username"]',
        'input[type="text"]',
    ];

    let usernameSelector = null;
    for (const selector of usernameSelectors) {
        const exists = await page.$(selector);
        if (exists) {
            console.log(`找到用户名输入框: ${selector}`);
            usernameSelector = selector;
            break;
        }
    }

    if (!usernameSelector) {
        throw new Error('无法找到用户名输入框');
    }

    // 尝试多个选择器来找到密码输入框
    const passwordSelectors = [
        '#id_password',
        'input[name="password"]',
        'input[type="password"]',
    ];

    let passwordSelector = null;
    for (const selector of passwordSelectors) {
        const exists = await page.$(selector);
        if (exists) {
            console.log(`找到密码输入框: ${selector}`);
            passwordSelector = selector;
            break;
        }
    }

    if (!passwordSelector) {
        throw new Error('无法找到密码输入框');
    }

    // 清空并填充用户名
    await page.evaluate((selector) => {
        document.querySelector(selector).value = '';
    }, usernameSelector);
    await page.type(usernameSelector, username, { delay: 50 });
    console.log('用户名已填充');
    await delayTime(300);

    // 清空并填充密码
    await page.evaluate((selector) => {
        document.querySelector(selector).value = '';
    }, passwordSelector);
    await page.type(passwordSelector, password, { delay: 50 });
    console.log('密码已填充');
    await delayTime(300);
}

async function clickLoginButton(page) {
    console.log('尝试点击登录按钮...');
    
    try {
        await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]');
            if (btn) {
                console.log('通过 evaluate 点击 submit 按钮');
                btn.click();
            } else {
                const anyBtn = document.querySelector('button');
                if (anyBtn) {
                    console.log('通过 evaluate 点击任意按钮');
                    anyBtn.click();
                } else {
                    throw new Error('找不到任何按钮元素');
                }
            }
        });
        console.log('登录按钮已点击');
        return true;
    } catch (e) {
        console.error(`点击按钮异常: ${e.message}`);
        throw new Error(`无法点击登录按钮: ${e.message}`);
    }
}

async function checkLoginSuccess(page) {
    console.log('检查登录状态...');
    
    try {
        // 方法1: 检查是否存在登出链接
        const hasLogoutLink = await page.$('a[href="/logout/"]');
        if (hasLogoutLink) {
            console.log('✓ 检测到登出链接，登录成功');
            return true;
        }

        // 方法2: 检查URL是否改变（不在登录页面）
        const currentUrl = page.url();
        console.log(`当前URL: ${currentUrl}`);
        if (!currentUrl.includes('login')) {
            console.log('✓ 已离开登录页面，登录成功');
            return true;
        }

        // 方法3: 获取页面内容进行诊断
        const pageInfo = await page.evaluate(() => {
            const errorElements = document.querySelectorAll('.error, .alert-danger, [class*="error"], [class*="fail"], [class*="invalid"]');
            const bodyText = document.body.innerText.substring(0, 500);
            const formPresent = document.querySelector('form') !== null;
            const loginInputs = document.querySelectorAll('input[type="text"], input[type="password"]');
            
            return {
                hasError: errorElements.length > 0,
                errorText: errorElements.length > 0 ? errorElements[0].textContent : null,
                formPresent: formPresent,
                inputCount: loginInputs.length,
                bodyPreview: bodyText
            };
        });

        console.log(`页面诊断信息:`);
        console.log(`  - 表单存在: ${pageInfo.formPresent}`);
        console.log(`  - 输入框数量: ${pageInfo.inputCount}`);
        console.log(`  - 有错误消息: ${pageInfo.hasError}`);
        if (pageInfo.errorText) {
            console.log(`  - 错误内容: ${pageInfo.errorText}`);
            return false;
        }

        // 如果登录表单仍然存在，说明登录失败
        if (pageInfo.formPresent && pageInfo.inputCount > 0) {
            console.log('✗ 登录表单仍然存在，登录失败');
            return false;
        }

        console.log('? 未能确定登录状态（假设成功）');
        return true;
    } catch (e) {
        console.error(`检查登录状态异常: ${e.message}`);
        return false;
    }
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
        console.log(`\n========================================`);
        console.log(`尝试登录账号 ${username}，地址: ${url}`);
        console.log(`========================================`);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'networkidle2' });
            console.log('页面加载完成');
            await delayTime(1000);

            // 填充登录表单
            await fillLoginForm(page, username, password);

            // 点击登录按钮
            await clickLoginButton(page);

            // 等待响应
            console.log('等待登录响应...');
            try {
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
                    delayTime(8000)
                ]);
            } catch (e) {
                console.log('导航等待完成或超时');
            }
            
            await delayTime(2000);

            // 检查是否登录成功
            const isLoggedIn = await checkLoginSuccess(page);

            const nowUtc = formatToISO(new Date());
            const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));

            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            const status = isLoggedIn ? "登录成功" : "登录失败";

            loginResults.push(`账号（${username}）（${serverName}）${status}`);

            console.log(`\n✓ 账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）${status}`);
        } catch (error) {
            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            loginResults.push(`账号（${username}）（${serverName}）登录时出现错误: ${error.message}`);
            console.error(`\n✗ 账号 ${username} 登录时出现错误: ${error.message}`);
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

    console.log('\n' + '='.repeat(50));
    console.log(finalReport);
    console.log('='.repeat(50));

    if (telegramToken && telegramChatId) {
        await sendTelegramMessage(telegramToken, telegramChatId, finalReport);
    }

    console.log('\n所有账号登录完成！');
})();
