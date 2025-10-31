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
    // 等待表单完全加载
    await page.waitForSelector('input[type="text"], input[name="login"], input[name="username"], #id_username', { timeout: 10000 });
    await delayTime(500);

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

    // 模拟真实用户：点击输入框
    await page.click(usernameSelector);
    await delayTime(200);

    // 清空并填充用户名 - 使用更真实的方式
    await page.evaluate((selector) => {
        document.querySelector(selector).value = '';
    }, usernameSelector);
    
    // 逐字符输入，模拟真实打字
    for (const char of username) {
        await page.type(usernameSelector, char, { delay: 80 + Math.random() * 40 });
    }

    await delayTime(300);

    // 点击密码框
    await page.click(passwordSelector);
    await delayTime(200);

    // 清空并填充密码
    await page.evaluate((selector) => {
        document.querySelector(selector).value = '';
    }, passwordSelector);
    
    for (const char of password) {
        await page.type(passwordSelector, char, { delay: 80 + Math.random() * 40 });
    }

    await delayTime(500);
}

async function clickLoginButton(page) {
    try {
        // 等待提交按钮可见
        await delayTime(300);
        
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
        // 等待页面稳定 - 增加等待时间
        await delayTime(2000);

        // 方法1: 检查是否存在登出链接
        const hasLogoutLink = await page.$('a[href="/logout/"]');
        if (hasLogoutLink) {
            return { success: true, reason: '找到登出链接' };
        }

        // 方法2: 检查URL是否改变（不在登录页面）
        const currentUrl = page.url();
        if (!currentUrl.includes('login') && !currentUrl.includes('auth')) {
            // 再次确认不是错误页面
            const hasLoginForm = await page.$('input[name="login"], input[name="username"], #id_username');
            if (!hasLoginForm) {
                return { success: true, reason: 'URL已跳转到面板' };
            }
        }

        // 方法3: 检查是否存在错误消息
        const errorMsg = await page.evaluate(() => {
            const errorElements = document.querySelectorAll('.error, .alert-danger, .errorlist, [class*="error"], [class*="fail"], [class*="invalid"]');
            if (errorElements.length > 0) {
                return errorElements[0].textContent.trim();
            }
            return null;
        });

        if (errorMsg) {
            return { success: false, reason: `错误消息: ${errorMsg}` };
        }

        // 方法4: 检查是否还在登录表单页面
        const hasLoginForm = await page.$('input[name="login"], input[name="username"], #id_username');
        if (hasLoginForm) {
            return { success: false, reason: '仍在登录页面，可能提交失败' };
        }

        // 方法5: 检查页面标题
        const title = await page.title();
        if (title.toLowerCase().includes('login') || title.toLowerCase().includes('sign in')) {
            return { success: false, reason: `页面标题显示登录: ${title}` };
        }

        // 如果没有明确的失败标志，认为成功
        return { success: true, reason: '页面已加载且无错误标志' };
    } catch (e) {
        return { success: false, reason: `检查异常: ${e.message}` };
    }
}

async function loginAccount(account, idx, totalCount, maxRetries = 3) {
    const { username, password, panelnum, domain } = account;

    let panel;
    if (domain === "ct8.pl") {
        panel = `panel.${domain}`;
    } else {
        panel = `panel${panelnum}.${domain || "serv00.com"}`;
    }

    const url = `https://${panel}/login/?next=/`;
    const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[${idx + 1}/${totalCount}] 登录 ${username}${attempt > 1 ? ` (第${attempt}次尝试)` : ''}`);

        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled', // 隐藏自动化特征
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        
        const page = await browser.newPage();

        try {
            // 设置 User-Agent 模拟真实浏览器
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // 隐藏 webdriver 特征
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false,
                });
            });

            // 设置更长的超时时间
            page.setDefaultTimeout(20000);
            
            console.log(`  → 访问 ${url}`);
            await page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 20000 
            });

            // 等待页面完全渲染
            await delayTime(1500);

            console.log(`  → 填写表单`);
            // 填充登录表单
            await fillLoginForm(page, username, password);

            console.log(`  → 提交登录`);
            // 点击登录按钮
            await clickLoginButton(page);

            // 等待导航完成
            console.log(`  → 等待响应`);
            try {
                await page.waitForNavigation({ 
                    waitUntil: 'networkidle2', 
                    timeout: 10000 
                });
            } catch (e) {
                // 即使导航超时也继续检查
                console.log(`  → 导航超时，继续检查...`);
            }

            // 额外等待确保页面加载完成
            await delayTime(2000);

            console.log(`  → 检查登录状态`);
            // 检查是否登录成功
            const result = await checkLoginSuccess(page);

            if (result.success) {
                console.log(`[${idx + 1}/${totalCount}] ✓ ${username} - ${result.reason}`);
                await page.close();
                await browser.close();
                return {
                    username,
                    serverName,
                    success: true,
                    message: `账号（${username}）（${serverName}）登录成功`
                };
            } else {
                console.log(`[${idx + 1}/${totalCount}] ✗ ${username} - ${result.reason}`);
                
                // 保存失败截图（仅在最后一次尝试）
                if (attempt === maxRetries) {
                    try {
                        const screenshotPath = `/tmp/login-fail-${username}-${Date.now()}.png`;
                        await page.screenshot({ path: screenshotPath, fullPage: true });
                        console.log(`  → 截图已保存: ${screenshotPath}`);
                    } catch (e) {
                        // 忽略截图错误
                    }
                }
                
                await page.close();
                await browser.close();
                
                if (attempt < maxRetries) {
                    // 重试前等待更长时间，避免触发限制
                    const retryDelay = 3000 + Math.random() * 3000;
                    console.log(`  → 等待 ${Math.round(retryDelay/1000)}秒后重试...`);
                    await delayTime(retryDelay);
                    continue;
                }
                
                return {
                    username,
                    serverName,
                    success: false,
                    message: `账号（${username}）（${serverName}）登录失败 - ${result.reason}`
                };
            }
        } catch (error) {
            console.error(`[${idx + 1}/${totalCount}] ✗ ${username} 出错: ${error.message}`);
            
            await page.close();
            await browser.close();
            
            if (attempt < maxRetries) {
                const retryDelay = 3000 + Math.random() * 3000;
                console.log(`  → 等待 ${Math.round(retryDelay/1000)}秒后重试...`);
                await delayTime(retryDelay);
                continue;
            }
            
            return {
                username,
                serverName,
                success: false,
                message: `账号（${username}）（${serverName}）登录时出现错误: ${error.message}`
            };
        }
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const loginResults = [];

    // 降低并发数，更稳定
    const concurrency = 2;
    const loginTasks = accounts.map((account, idx) => async () => {
        const result = await loginAccount(account, idx, accounts.length);
        loginResults.push(result);
    });

    // 分批执行
    for (let i = 0; i < loginTasks.length; i += concurrency) {
        const batch = loginTasks.slice(i, i + concurrency);
        await Promise.all(batch.map(task => task()));
        
        // 批次之间延迟 2-4秒
        if (i + concurrency < loginTasks.length) {
            const delay = Math.random() * 2000 + 2000;
            console.log(`\n⏳ 批次完成，等待 ${Math.round(delay/1000)}秒...\n`);
            await delayTime(delay);
        }
    }

    // 统计结果
    const successCount = loginResults.filter(r => r.success).length;
    const failCount = loginResults.filter(r => !r.success).length;

    // 汇总并发送报告
    const reportTitle = `ct8&serv00登陆报告（成功: ${successCount}/${accounts.length}, 失败: ${failCount}）：`;
    const reportContent = loginResults.map(r => r.message).join('\n');
    const finalReport = `${reportTitle}\n${reportContent}`;

    console.log('\n' + '='.repeat(50));
    console.log(finalReport);
    console.log('='.repeat(50));

    if (telegramToken && telegramChatId) {
        await sendTelegramMessage(telegramToken, telegramChatId, finalReport);
    }

    console.log(`\n✅ 所有账号登录完成！成功: ${successCount}/${accounts.length}, 失败: ${failCount}`);
    
    // 如果有失败，退出码为1
    if (failCount > 0) {
        process.exit(1);
    }
})();
