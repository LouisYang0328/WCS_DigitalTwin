namespace WcsGateway.Security;

public sealed record LoginRequest(string Username, string Password);
public sealed record PasswordRequest(string Password);
public sealed record UserStatusRequest(bool Enabled);
public sealed record CreateUserRequest(string Username, string DisplayName, string Password, string Role);

public sealed record UserResponse(
    string Id,
    string Username,
    string DisplayName,
    string Role,
    IReadOnlyList<string> Permissions);

public sealed record UserAdminResponse(
    string Id,
    string Username,
    string DisplayName,
    string Role,
    bool Enabled,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt);

public sealed record SessionLogin(UserResponse User, string Token, DateTimeOffset ExpiresAt);

public sealed record DashboardPanelRequest(string Id, string Label, bool Visible, int Order);

public sealed record DashboardConfigRequest(
    string Title,
    int RefreshSeconds,
    int TaskTarget,
    decimal TaskRateTarget,
    decimal CellTarget,
    IReadOnlyList<DashboardPanelRequest> Panels);

public sealed record DashboardConfigResponse(
    string Id,
    string Title,
    int RefreshSeconds,
    int TaskTarget,
    decimal TaskRateTarget,
    decimal CellTarget,
    IReadOnlyList<DashboardPanelRequest> Panels,
    DateTimeOffset UpdatedAt,
    string UpdatedBy);
