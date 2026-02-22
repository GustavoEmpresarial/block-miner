# Admin Login System

## Overview

BlockMiner now features a dedicated admin login page that provides secure access to the admin dashboard without requiring user authentication credentials.

## Features

- **Independent Authentication**: Admin login uses email and security code, independent from user authentication
- **JWT Tokens**: Admin sessions are secured with JWT tokens
- **Rate Limiting**: Login attempts are rate-limited to prevent brute force attacks (5 attempts per 15 minutes)
- **Session Expiration**: Admin sessions automatically expire after 24 hours (configurable)
- **Secure Credentials**: All credentials are stored as environment variables

## Configuration

### Environment Variables

Add these variables to your `.env` file:

```dotenv
# Admin login credentials
# Email for admin login
ADMIN_EMAIL=admin@blockminer.com

# Security code for admin login (minimum 4 characters, recommended 8+)
ADMIN_SECURITY_CODE=SecureCode123!

# JWT expiration time for admin sessions (default: 24h)
ADMIN_JWT_EXPIRES_IN=24h
```

### Security Recommendations

1. **Change the default credentials** immediately after setup
2. **Use a strong security code**: At least 8 characters with mixed case and special characters
3. **Rotate credentials regularly** in production environments
4. **Keep `.env` file secure**: Never commit to version control
5. **Use HTTPS** in production environments

## Usage

### Accessing the Admin Panel

1. Navigate to `https://yourdomain.com/admin/login`
2. Enter the admin email
3. Enter the admin security code
4. Click "Entrar" (Login)
5. You'll be redirected to the admin dashboard at `/admin/`

### Admin Dashboard

The admin dashboard provides access to:

- **Dashboard**: Overview statistics and recent users
- **Users Management**: View, search, and ban users
- **Audit Logs**: Track all admin actions
- **Miners Management**: Create, edit, and manage mining equipment
- **Withdrawals**: Approve, reject, or complete withdrawal requests

### Logging Out

To log out from the admin panel, clear your browser's local storage or simply close the browser window. The session will automatically expire after 24 hours.

## Technical Details

### Login Flow

1. User submits email and security code to `/api/admin/login`
2. Server validates credentials against `ADMIN_EMAIL` and `ADMIN_SECURITY_CODE`
3. On successful authentication, server returns a JWT token
4. Client stores token in `localStorage` as `adminToken`
5. Token is sent with each API request via `Authorization` header

### API Endpoints

#### POST /api/admin/login

**Request:**
```json
{
  "email": "admin@blockminer.com",
  "securityCode": "SecureCode123!"
}
```

**Response (Success):**
```json
{
  "ok": true,
  "message": "Autenticado com sucesso",
  "token": "eyJhbGc...",
  "expiresIn": "24h"
}
```

**Response (Failure):**
```json
{
  "ok": false,
  "message": "Credenciais inválidas"
}
```

### Protected Routes

All `/api/admin/*` routes require a valid admin JWT token:

- `GET /api/admin/stats` - Get dashboard statistics
- `GET /api/admin/users` - List recent users
- `GET /api/admin/audit` - Get audit logs
- `PUT /api/admin/users/:id/ban` - Ban/unban user
- `GET /api/admin/miners` - List all miners
- `POST /api/admin/miners` - Create new miner
- `PUT /api/admin/miners/:id` - Update miner
- `GET /api/admin/withdrawals/pending` - List pending withdrawals
- `POST /api/admin/withdrawals/:withdrawalId/approve` - Approve withdrawal
- `POST /api/admin/withdrawals/:withdrawalId/reject` - Reject withdrawal
- `POST /api/admin/withdrawals/:withdrawalId/complete` - Complete withdrawal

## File Structure

```
admin/
├── login.html           # Login page UI
├── login-styles.css     # Login page styles
├── login.js             # Login page logic
├── index.html           # Admin dashboard
├── admin.js             # Dashboard logic
└── styles.css           # Dashboard styles

controllers/
└── adminAuthController.js    # Login authentication logic

middleware/
├── adminAuth.js              # JWT token validation
└── adminPageAuth.js          # Page-level authentication

routes/
└── admin-auth.js             # Login route definition
```

## Security Considerations

### Vulnerability Prevention

- **Timing Attacks**: Uses timing-safe token comparison
- **Rate Limiting**: Prevents brute force attacks
- **HTTPS Only**: Tokens should only be transmitted over secure connections
- **Token Expiration**: Sessions automatically expire
- **CSRF Protection**: Admin pages are protected with CSRF tokens
- **Input Validation**: All credentials are validated and trimmed

### Best Practices

1. **Use Environment Variables**: Never hardcode credentials
2. **Secure Transportation**: Always use HTTPS/TLS in production
3. **Token Storage**: Store tokens in `localStorage` (XSS vulnerability must be prevented elsewhere)
4. **Session Timeout**: Consider implementing additional session timeout on the frontend
5. **Audit Logging**: All admin actions are logged for compliance

## Troubleshooting

### "Credenciais inválidas"

- Verify `ADMIN_EMAIL` and `ADMIN_SECURITY_CODE` are set correctly in `.env`
- Check that environment variables are properly loaded
- Ensure no extra spaces in credentials

### "Admin authentication not configured"

- Verify `.env` file contains `ADMIN_EMAIL` and `ADMIN_SECURITY_CODE`
- Restart the server after modifying `.env`

### Session keeps expiring

- Check `ADMIN_JWT_EXPIRES_IN` setting (default is 24h)
- Token might have expired due to time-related issues
- Clear local storage and login again

### CORS errors when authenticating

- Ensure `CORS_ORIGINS` is properly configured in `.env`
- For development, can be left empty for localhost only

## Future Enhancements

Potential improvements to the admin authentication system:

- [ ] Two-factor authentication (2FA)
- [ ] OAuth2 integration
- [ ] Admin activity logging with detailed actions
- [ ] IP whitelist functionality
- [ ] Multi-device session management
- [ ] Admin role-based access control (RBAC)
