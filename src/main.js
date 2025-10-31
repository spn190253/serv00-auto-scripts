async function loginWithRetry(account, idx, totalCount, maxRetries = 2) {
    const { username, password, panelnum, domain } = account;
    
    let panel;
    if (domain === "ct8.pl") {
        panel = `panel.${domain}`;
    } else {
        panel = `${panelBaseUrl}${panelnum}.${domain || defaultDomain}`;
    }
    
    const url = `https://${panel}/login/?next=/`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        const page = await browser.newPage();
        
        try {
            console.log(`[${idx + 1}/${totalCount}] 登录 ${username}${attempt > 1 ? ` (重试 ${attempt}/${maxRetries})` : ''}`);
            
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await delayTime(1000); // 确保页面完全加载
            
            // 填充登录表单
            await fillLoginForm(page, username, password);
            await delayTime(500);import fs from 'fs';
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

    let usernameSelector = null;
    for (const selector of usernameSelectors) {
        const exists = await page.$(selector);
        if (exists) {
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
    await page.type(usernameSelector, username, { delay: 30 });

    // 清空并填充密码
    await page.evaluate((selector) => {
        document.querySelector(selector).value = '';
    }, passwordSelector);
    await page.type(passwordSelector, password, { delay: 30 });
}

async function clickLoginButton(page) {
    try {
        await page.evaluate(() => {
            // 找到所有表单，选择不是语言切换的那个
            const forms = document.querySelectorAll('form');
            let loginForm = null;
            
            for (const form of forms) {
                // 跳过语言切换表单
                if (form.action.includes('/lang/') || form.getAttribute('data-language-form')) {
                    continue;
                }
                // 找到包含用户名/密码的表单
                if (form.querySelector('input[name="login"], input[name="username"], #id_username')) {
                    loginForm = form;
                    break;
                }
            }
            
            if (loginForm) {
                loginForm.submit();
                return;
            }
            
            // 后备方案：找任何 submit 按钮并点击
            const btn = document.querySelector('button[type="submit"]');
            if (btn) {
                const form = btn.closest('form');
                if (form && !form.action.includes('/lang/')) {
                    btn.click();
                    return;
                }
            }
            
            throw new Error('找不到登录表单或登录按钮');
        });
    } catch (e) {
        throw new Error(`无法提交登录表单: ${e.message}`);
    }
}

async function checkLoginSuccess(page) {
    try {
        // 方法1: 检查是否存在登出链接
        const hasLogoutLink = await page.$('a[href="/logout/"]');
        if (hasLogoutLink) {
            return true;
        }

        // 方法2: 检查URL是否改变（不在登录页面）
        const currentUrl = page.url();
        if (!currentUrl.includes('login')) {
            return true;
        }

        // 方法3: 检查是否存在错误消息
        const errorMsg = await page.evaluate(() => {
            const errorElements = document.querySelectorAll('.error, .alert-danger, [class*="error"], [class*="fail"], [class*="invalid"]');
            if (errorElements.length > 0) {
                return errorElements[0].textContent;
            }
            return null;
        });

        return !errorMsg;
    } catch (e) {
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

    // 2个并行登录（平衡速度和安全）
    const concurrency = 2;
    const loginTasks = accounts.map((account, idx) => async () => {
        const { username, password, panelnum, domain } = account;

        let panel;
        if (domain === "ct8.pl") {
            panel = `panel.${domain}`;
        } else {
            panel = `${panelBaseUrl}${panelnum}.${domain || defaultDomain}`;
        }

        const url = `https://${panel}/login/?next=/`;
        console.log(`[${idx + 1}/${accounts.length}] 登录 ${username}`);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            // 填充登录表单
            await fillLoginForm(page, username, password);

            // 点击登录按钮
            await clickLoginButton(page);

            // 等待响应
            try {
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {}),
                    delayTime(4000)
                ]);
            } catch (e) {
                // 继续
            }
            
            await delayTime(300);

            // 检查是否登录成功
            const isLoggedIn = await checkLoginSuccess(page);

            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            const status = isLoggedIn ? "✓" : "✗";

            loginResults.push(`账号（${username}）（${serverName}）${isLoggedIn ? "登录成功" : "登录失败"}`);

            console.log(`[${idx + 1}/${accounts.length}] ${status} ${username}`);
        } catch (error) {
            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            loginResults.push(`账号（${username}）（${serverName}）登录时出现错误: ${error.message}`);
            console.error(`[${idx + 1}/${accounts.length}] ✗ ${username} 出错: ${error.message}`);
        } finally {
            await page.close();
            await browser.close();
        }
    });

    // 分批执行（2个并行）
    for (let i = 0; i < loginTasks.length; i += concurrency) {
        const batch = loginTasks.slice(i, i + concurrency);
        await Promise.all(batch.map(task => task()));
        
        // 批次之间随机延迟 1-2秒
        if (i + concurrency < loginTasks.length) {
            const delay = Math.random() * 1000 + 1000;
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
