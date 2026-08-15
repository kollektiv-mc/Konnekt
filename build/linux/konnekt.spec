Name:           konnekt
Version:        %{_version}
Release:        1%{?dist}
Summary:        Minecraft server dashboard
License:        Proprietary
URL:            https://github.com/kollektiv-mc/Konnekt

Source0:        konnekt-linux-amd64
Source1:        konnekt.desktop
Source2:        appicon.png

BuildArch:      x86_64

# Source0 is a prebuilt binary (built against webkit2gtk-4.1 in a separate CI
# job), not sources rpmbuild compiles — auto dependency scanning would pick up
# sonames from the build container instead of the packaging container, so
# runtime deps are declared by hand instead.
AutoReqProv:    no
Requires:       webkit2gtk4.1
Requires:       gtk3

%description
Konnekt is a desktop dashboard for managing Minecraft servers: process
control, live console, real-time stats, player management, scheduled tasks,
world management, and backups.

%prep
# nothing to unpack — Source0 is a prebuilt binary

%build
# nothing to build — Source0 is a prebuilt binary

%install
install -Dm755 %{SOURCE0} %{buildroot}%{_bindir}/konnekt
install -Dm644 %{SOURCE1} %{buildroot}%{_datadir}/applications/konnekt.desktop
install -Dm644 %{SOURCE2} %{buildroot}%{_datadir}/pixmaps/konnekt.png

%files
%{_bindir}/konnekt
%{_datadir}/applications/konnekt.desktop
%{_datadir}/pixmaps/konnekt.png

%changelog
