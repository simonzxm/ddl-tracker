import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import get_settings

settings = get_settings()


async def send_verification_email(to_email: str, code: str) -> bool:
    """Send verification code email"""
    if settings.app_env == "development" and not settings.smtp_host:
        # In development without SMTP config, just print the code
        print(f"[DEV] Verification code for {to_email}: {code}")
        return True
    
    message = MIMEMultipart("alternative")
    message["From"] = settings.smtp_from
    message["To"] = to_email
    message["Subject"] = f"【DDL Tracker】验证码: {code}"
    
    text_content = f"""
你好！

你正在注册 DDL Tracker 账号，你的验证码是：

{code}

验证码有效期为 10 分钟，请勿泄露给他人。

如果这不是你的操作，请忽略此邮件。

——
DDL Tracker 团队
"""
    
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
        .container {{ max-width: 500px; margin: 0 auto; padding: 20px; }}
        .code {{ font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 4px; padding: 20px; background: #f1f5f9; border-radius: 8px; text-align: center; margin: 20px 0; }}
        .footer {{ color: #64748b; font-size: 12px; margin-top: 30px; }}
    </style>
</head>
<body>
    <div class="container">
        <h2>验证你的邮箱</h2>
        <p>你好！你正在注册 DDL Tracker 账号，请使用以下验证码完成注册：</p>
        <div class="code">{code}</div>
        <p>验证码有效期为 <strong>10 分钟</strong>，请勿泄露给他人。</p>
        <p>如果这不是你的操作，请忽略此邮件。</p>
        <div class="footer">
            <p>—— DDL Tracker 团队</p>
        </div>
    </div>
</body>
</html>
"""
    
    message.attach(MIMEText(text_content, "plain", "utf-8"))
    message.attach(MIMEText(html_content, "html", "utf-8"))
    
    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            start_tls=True,
        )
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False
