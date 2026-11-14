using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using WcsGateway.Data;

namespace WcsGateway.Security;

public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AuthService auth,
    SecurityOptions security)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "WcsSession";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(security.CookieName, out var token) || string.IsNullOrWhiteSpace(token))
            return AuthenticateResult.NoResult();
        try
        {
            var user = await auth.FindByTokenAsync(token, Context.RequestAborted);
            if (user is null) return AuthenticateResult.NoResult();
            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim("display_name", user.DisplayName),
                new Claim(ClaimTypes.Role, user.Role)
            };
            var identity = new ClaimsIdentity(claims, SchemeName);
            return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
        }
        catch (InvalidOperationException)
        {
            // Database initialization is still running; anonymous response lets the login page retry.
            return AuthenticateResult.NoResult();
        }
    }
}
